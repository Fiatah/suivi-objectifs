/**
 * ENGINE.JS - Intégration Supabase, Auth & Multi-utilisateurs.
 */

const SUPABASE_URL = 'https://fsmlbnhzlahvwyzuqmfn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jriiHfQgiudht4X5zzIQNA_Bqiox33y';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DAYS_MAP = [
  { key: 'MON', label: 'L' },
  { key: 'TUE', label: 'M' },
  { key: 'WED', label: 'M' },
  { key: 'THU', label: 'J' },
  { key: 'FRI', label: 'V' },
  { key: 'SAT', label: 'S' },
  { key: 'SUN', label: 'D' }
];

let currentUser = null;
let selectedHistoryDate = null; // null = Aujourd'hui

let globalState = {
  groups: [],
  tasks: [],
  goals: [],
  logs: {}
};

// Vérification de session Auth Supabase
async function initAuth(onAuthChange) {
  const { data: { session } } = await _supabase.auth.getSession();
  currentUser = session?.user || null;

  _supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    if (onAuthChange) onAuthChange(currentUser);
  });

  return currentUser;
}

async function signUpUser(email, password) {
  const { data, error } = await _supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

async function signInUser(email, password) {
  const { data, error } = await _supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signOutUser() {
  await _supabase.auth.signOut();
  currentUser = null;
  globalState = { groups: [], tasks: [], goals: [], logs: {} };
}

// Initialisation globale depuis Supabase pour l'utilisateur courant
async function initApp() {
  if (!currentUser) return;
  await fetchStateFromSupabase();
  renderUI();
}

function loadState() {
  return globalState;
}

// Chargement complet des données Supabase
async function fetchStateFromSupabase() {
  if (!currentUser) return;

  try {
    const [gRes, tRes, goalRes, sgRes, lRes] = await Promise.all([
      _supabase.from('groups').select('*').eq('user_id', currentUser.id),
      _supabase.from('tasks').select('*').eq('user_id', currentUser.id),
      _supabase.from('goals').select('*').eq('user_id', currentUser.id),
      _supabase.from('sub_goals').select('*').eq('user_id', currentUser.id),
      _supabase.from('logs').select('*').eq('user_id', currentUser.id)
    ]);

    if (gRes.data && gRes.data.length === 0) {
      await seedInitialData();
      return await fetchStateFromSupabase();
    }

    const groups = gRes.data || [];
    const tasks = tRes.data || [];
    const goalsRaw = goalRes.data || [];
    const subGoalsRaw = sgRes.data || [];
    const logsRaw = lRes.data || [];

    const goals = goalsRaw.map(g => {
      if (g.type === 'SCALE') {
        const subGoals = subGoalsRaw
          .filter(sg => sg.goal_id === g.id)
          .map(sg => ({
            id: sg.id,
            title: sg.title,
            taskIds: tasks.filter(t => t.sub_goal_id === sg.id).map(t => t.id)
          }));
        return { id: g.id, title: g.title, type: g.type, groupId: g.group_id, subGoals };
      } else {
        const directTaskIds = tasks.filter(t => t.goal_id === g.id && !t.sub_goal_id).map(t => t.id);
        return { id: g.id, title: g.title, type: g.type, groupId: g.group_id, directTaskIds };
      }
    });

    const logs = {};
    logsRaw.forEach(l => {
      if (!logs[l.date_str]) logs[l.date_str] = {};
      logs[l.date_str][l.task_id] = { completed: l.completed, points: l.points };
    });

    const formattedTasks = tasks.map(t => ({
      id: t.id,
      title: t.title,
      points: t.points,
      groupId: t.group_id,
      goalId: t.goal_id,
      days: Array.isArray(t.days) ? t.days : JSON.parse(t.days || '[]')
    }));

    globalState = { groups, tasks: formattedTasks, goals, logs };
  } catch (err) {
    console.error("Erreur Supabase :", err);
  }
}

async function seedInitialData() {
  if (!currentUser) return;
  const gId = 'g_' + Date.now();
  const goalId = 'goal_' + Date.now();
  const sgId = 'sg_' + Date.now();
  const tId = 't_' + Date.now();

  await _supabase.from('groups').insert([{ id: gId, name: 'Carrière & Compétences', icon: '🚀', weight: 3, user_id: currentUser.id }]);
  await _supabase.from('goals').insert([{ id: goalId, title: 'Mon Premier Objectif', type: 'SCALE', group_id: gId, user_id: currentUser.id }]);
  await _supabase.from('sub_goals').insert([{ id: sgId, goal_id: goalId, title: 'Étape 1', user_id: currentUser.id }]);
  await _supabase.from('tasks').insert([{ id: tId, title: 'Ma première tâche', points: 30, group_id: gId, goal_id: goalId, sub_goal_id: sgId, days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], user_id: currentUser.id }]);
}

function getTodayString() {
  return selectedHistoryDate || new Date().toISOString().split('T')[0];
}

function getTodayDayKey() {
  const dateObj = selectedHistoryDate ? new Date(selectedHistoryDate) : new Date();
  const dayIndex = dateObj.getDay();
  const keys = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return keys[dayIndex];
}

function getCurrentWeekDates() {
  const curr = selectedHistoryDate ? new Date(selectedHistoryDate) : new Date();
  const first = curr.getDate() - (curr.getDay() === 0 ? 6 : curr.getDay() - 1);
  const dates = [];

  for (let i = 0; i < 7; i++) {
    const next = new Date(curr);
    next.setDate(first + i);
    dates.push(next.toISOString().split('T')[0]);
  }
  return dates;
}

function calculateGlobalScores(mode = 'daily') {
  const st = loadState();
  const datesToEvaluate = mode === 'daily' ? [getTodayString()] : getCurrentWeekDates();

  let totalRawExpected = 0;
  let totalRawEarned = 0;
  let totalWeightedExpected = 0;
  let totalWeightedEarned = 0;

  datesToEvaluate.forEach(dateStr => {
    const dayDate = new Date(dateStr);
    const dayKeys = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const currentDayKey = dayKeys[dayDate.getDay()];
    const logs = st.logs[dateStr] || {};

    st.tasks.forEach(task => {
      const isTaskActiveForDay = !task.days || task.days.length === 0 || task.days.includes(currentDayKey);
      if (!isTaskActiveForDay) return;

      const group = st.groups.find(g => g.id === task.groupId);
      const weight = group ? (group.weight || 1) : 1;
      const taskPts = parseInt(task.points) || 10;

      totalRawExpected += taskPts;
      totalWeightedExpected += (taskPts * weight);

      if (logs[task.id]?.completed) {
        totalRawEarned += taskPts;
        totalWeightedEarned += (taskPts * weight);
      }
    });
  });

  const rawPct = totalRawExpected > 0 ? Math.round((totalRawEarned / totalRawExpected) * 100) : 0;
  const weightedPct = totalWeightedExpected > 0 ? Math.round((totalWeightedEarned / totalWeightedExpected) * 100) : 0;

  return {
    raw: { earned: totalRawEarned, expected: totalRawExpected, pct: rawPct },
    weighted: { earned: totalWeightedEarned, expected: totalWeightedEarned, pct: weightedPct }
  };
}

// BASCIULE DE COCHAGE DE TÂCHE
async function toggleTaskLog(taskId, dateStr = getTodayString()) {
  if (!currentUser) return;
  const st = loadState();
  if (!st.logs[dateStr]) st.logs[dateStr] = {};

  const task = st.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (st.logs[dateStr][taskId]?.completed) {
    delete st.logs[dateStr][taskId];
    await _supabase.from('logs').delete().eq('date_str', dateStr).eq('task_id', taskId).eq('user_id', currentUser.id);
  } else {
    const pts = parseInt(task.points) || 10;
    st.logs[dateStr][taskId] = { completed: true, points: pts };
    await _supabase.from('logs').upsert({ 
      date_str: dateStr, 
      task_id: taskId, 
      points: pts, 
      completed: true, 
      user_id: currentUser.id 
    }, { onConflict: 'user_id,date_str,task_id' });
  }
}

// GESTION DES GROUPES
async function addGroup(name, icon, weight = 1) {
  if (!currentUser) return;
  const id = 'g_' + Date.now();
  const newGroup = { id, name, icon: icon || '📁', weight: parseInt(weight) || 1 };
  globalState.groups.push(newGroup);
  await _supabase.from('groups').insert([{ id, name, icon: icon || '📁', weight: parseInt(weight) || 1, user_id: currentUser.id }]);
}

async function deleteGroup(groupId) {
  if (!currentUser) return;
  globalState.groups = globalState.groups.filter(g => g.id !== groupId);
  globalState.tasks = globalState.tasks.filter(t => t.groupId !== groupId);
  await _supabase.from('groups').delete().eq('id', groupId).eq('user_id', currentUser.id);
}

async function updateGroupWeight(groupId, newWeight) {
  if (!currentUser) return;
  const weight = Math.max(1, parseInt(newWeight) || 1);
  const group = globalState.groups.find(g => g.id === groupId);
  if (group) group.weight = weight;
  await _supabase.from('groups').update({ weight }).eq('id', groupId).eq('user_id', currentUser.id);
}

// GESTION DES TÂCHES
async function addStandaloneTask(title, points, groupId, daysArray) {
  if (!currentUser) return;
  const id = 'task_' + Date.now();
  const days = daysArray || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const pts = parseInt(points) || 10;

  globalState.tasks.push({ id, title, points: pts, groupId, days });
  await _supabase.from('tasks').insert([{ id, title, points: pts, group_id: groupId, days, user_id: currentUser.id }]);
}

async function deleteTask(taskId) {
  if (!currentUser) return;
  globalState.tasks = globalState.tasks.filter(t => t.id !== taskId);
  globalState.goals.forEach(goal => {
    if (goal.directTaskIds) goal.directTaskIds = goal.directTaskIds.filter(id => id !== taskId);
    if (goal.subGoals) {
      goal.subGoals.forEach(sg => sg.taskIds = sg.taskIds.filter(id => id !== taskId));
    }
  });
  await _supabase.from('tasks').delete().eq('id', taskId).eq('user_id', currentUser.id);
}

async function updateTask(taskId, newTitle, newPoints, newDays) {
  if (!currentUser) return;
  const pts = parseInt(newPoints) || 10;
  const task = globalState.tasks.find(t => t.id === taskId);
  if (task) {
    task.title = newTitle;
    task.points = pts;
    task.days = newDays;
  }
  await _supabase.from('tasks').update({ title: newTitle, points: pts, days: newDays }).eq('id', taskId).eq('user_id', currentUser.id);
}

// GESTION DES OBJECTIFS
async function addComplexGoal(title, type, groupId, structuredData) {
  if (!currentUser) return;
  const goalId = 'goal_' + Date.now();
  const newGoal = { id: goalId, title, type, groupId };

  await _supabase.from('goals').insert([{ id: goalId, title, type, group_id: groupId, user_id: currentUser.id }]);

  if (type === 'SCALE') {
    newGoal.subGoals = [];
    for (let sIndex = 0; sIndex < structuredData.length; sIndex++) {
      const sg = structuredData[sIndex];
      const subGoalId = `sg_${goalId}_${sIndex}`;
      await _supabase.from('sub_goals').insert([{ id: subGoalId, goal_id: goalId, title: sg.title, user_id: currentUser.id }]);

      const taskIds = [];
      for (let tIndex = 0; tIndex < sg.tasks.length; tIndex++) {
        const t = sg.tasks[tIndex];
        const taskId = `t_${goalId}_${sIndex}_${tIndex}_${Date.now()}`;
        const pts = parseInt(t.points) || 20;

        globalState.tasks.push({ id: taskId, title: t.title, points: pts, groupId, days: t.days, goalId });
        await _supabase.from('tasks').insert([{
          id: taskId, title: t.title, points: pts, group_id: groupId, goal_id: goalId, sub_goal_id: subGoalId, days: t.days, user_id: currentUser.id
        }]);
        taskIds.push(taskId);
      }
      newGoal.subGoals.push({ id: subGoalId, title: sg.title, taskIds });
    }
  } else {
    newGoal.directTaskIds = [];
    for (let tIndex = 0; tIndex < structuredData[0].tasks.length; tIndex++) {
      const t = structuredData[0].tasks[tIndex];
      const taskId = `t_${goalId}_d_${tIndex}_${Date.now()}`;
      const pts = parseInt(t.points) || 20;

      globalState.tasks.push({ id: taskId, title: t.title, points: pts, groupId, days: t.days, goalId });
      await _supabase.from('tasks').insert([{
        id: taskId, title: t.title, points: pts, group_id: groupId, goal_id: goalId, days: t.days, user_id: currentUser.id
      }]);
      newGoal.directTaskIds.push(taskId);
    }
  }

  globalState.goals.push(newGoal);
}

async function deleteGoal(goalId) {
  if (!currentUser) return;
  globalState.goals = globalState.goals.filter(g => g.id !== goalId);
  globalState.tasks = globalState.tasks.filter(t => t.goalId !== goalId);
  await _supabase.from('goals').delete().eq('id', goalId).eq('user_id', currentUser.id);
}
