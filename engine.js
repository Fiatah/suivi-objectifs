/**
 * ENGINE.JS - Version Directe Sans Authentification
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

let selectedHistoryDate = null; // null = Toujours la date système du jour
let lastKnownLocalDate = getLocalDateString();

let globalState = {
  groups: [],
  tasks: [],
  goals: [],
  logs: {}
};

// Fonction utilitaire pour obtenir la date locale exacte au format YYYY-MM-DD
function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Initialisation directe sans Auth
async function initApp() {
  await fetchStateFromSupabase();

  // Détecteur de changement de jour (passé minuit ou reprise d'activité)
  setInterval(checkDayChange, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkDayChange();
    }
  });

  renderUI();
}

function checkDayChange() {
  const currentToday = getLocalDateString();
  if (currentToday !== lastKnownLocalDate) {
    lastKnownLocalDate = currentToday;
    if (selectedHistoryDate === null) {
      const picker = document.getElementById('history-date-picker');
      if (picker) picker.value = currentToday;
      renderUI();
    }
  }
}

function loadState() {
  return globalState;
}

// Chargement complet des données depuis Supabase
async function fetchStateFromSupabase() {
  try {
    const [gRes, tRes, goalRes, sgRes, lRes] = await Promise.all([
      _supabase.from('groups').select('*'),
      _supabase.from('tasks').select('*'),
      _supabase.from('goals').select('*'),
      _supabase.from('sub_goals').select('*'),
      _supabase.from('logs').select('*')
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
    console.error("Erreur de chargement Supabase :", err);
  }
}

async function seedInitialData() {
  const gId = 'g_' + Date.now();
  const goalId = 'goal_' + Date.now();
  const sgId = 'sg_' + Date.now();
  const tId = 't_' + Date.now();

  await _supabase.from('groups').insert([{ id: gId, name: 'Carrière & Compétences', icon: '🚀', weight: 3 }]);
  await _supabase.from('goals').insert([{ id: goalId, title: 'Mon Premier Objectif', type: 'SCALE', group_id: gId }]);
  await _supabase.from('sub_goals').insert([{ id: sgId, goal_id: goalId, title: 'Étape 1' }]);
  await _supabase.from('tasks').insert([{ id: tId, title: 'Ma première tâche', points: 30, group_id: gId, goal_id: goalId, sub_goal_id: sgId, days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] }]);
}

function getTodayString() {
  return selectedHistoryDate || getLocalDateString();
}

function getTodayDayKey() {
  const dateStr = getTodayString();
  const parts = dateStr.split('-');
  const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  const dayIndex = dateObj.getDay();
  const keys = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return keys[dayIndex];
}

function getCurrentWeekDates() {
  const dateStr = getTodayString();
  const parts = dateStr.split('-');
  const curr = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  
  const first = curr.getDate() - (curr.getDay() === 0 ? 6 : curr.getDay() - 1);
  const dates = [];

  for (let i = 0; i < 7; i++) {
    const next = new Date(curr);
    next.setDate(first + i);
    const y = next.getFullYear();
    const m = String(next.getMonth() + 1).padStart(2, '0');
    const d = String(next.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
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
    const parts = dateStr.split('-');
    const dayDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
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
    weighted: { earned: totalWeightedEarned, expected: totalWeightedExpected, pct: weightedPct }
  };
}

// BASCULE DE COCHAGE DE TÂCHE
async function toggleTaskLog(taskId, dateStr = getTodayString()) {
  const st = loadState();
  if (!st.logs[dateStr]) st.logs[dateStr] = {};

  const task = st.tasks.find(t => t.id === taskId);
  if (!task) return;

  if (st.logs[dateStr][taskId]?.completed) {
    delete st.logs[dateStr][taskId];
    await _supabase.from('logs').delete().eq('date_str', dateStr).eq('task_id', taskId);
  } else {
    const pts = parseInt(task.points) || 10;
    st.logs[dateStr][taskId] = { completed: true, points: pts };
    await _supabase.from('logs').upsert({ 
      date_str: dateStr, 
      task_id: taskId, 
      points: pts, 
      completed: true 
    }, { onConflict: 'date_str,task_id' });
  }
}

// GESTION DES GROUPES
async function addGroup(name, icon, weight = 1) {
  const id = 'g_' + Date.now();
  const newGroup = { id, name, icon: icon || '📁', weight: parseInt(weight) || 1 };
  globalState.groups.push(newGroup);
  await _supabase.from('groups').insert([{ id, name, icon: icon || '📁', weight: parseInt(weight) || 1 }]);
}

async function deleteGroup(groupId) {
  globalState.groups = globalState.groups.filter(g => g.id !== groupId);
  globalState.tasks = globalState.tasks.filter(t => t.groupId !== groupId);
  await _supabase.from('groups').delete().eq('id', groupId);
}

async function updateGroupWeight(groupId, newWeight) {
  const weight = Math.max(1, parseInt(newWeight) || 1);
  const group = globalState.groups.find(g => g.id === groupId);
  if (group) group.weight = weight;
  await _supabase.from('groups').update({ weight }).eq('id', groupId);
}

// GESTION DES TÂCHES
async function addStandaloneTask(title, points, groupId, daysArray) {
  const id = 'task_' + Date.now();
  const days = daysArray || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const pts = parseInt(points) || 10;

  globalState.tasks.push({ id, title, points: pts, groupId, days });
  await _supabase.from('tasks').insert([{ id, title, points: pts, group_id: groupId, days }]);
}

async function deleteTask(taskId) {
  globalState.tasks = globalState.tasks.filter(t => t.id !== taskId);
  globalState.goals.forEach(goal => {
    if (goal.directTaskIds) goal.directTaskIds = goal.directTaskIds.filter(id => id !== taskId);
    if (goal.subGoals) {
      goal.subGoals.forEach(sg => sg.taskIds = sg.taskIds.filter(id => id !== taskId));
    }
  });
  await _supabase.from('tasks').delete().eq('id', taskId);
}

async function updateTask(taskId, newTitle, newPoints, newDays) {
  const pts = parseInt(newPoints) || 10;
  const task = globalState.tasks.find(t => t.id === taskId);
  if (task) {
    task.title = newTitle;
    task.points = pts;
    task.days = newDays;
  }
  await _supabase.from('tasks').update({ title: newTitle, points: pts, days: newDays }).eq('id', taskId);
}

// GESTION DES OBJECTIFS
async function addComplexGoal(title, type, groupId, structuredData) {
  const goalId = 'goal_' + Date.now();
  const newGoal = { id: goalId, title, type, groupId };

  await _supabase.from('goals').insert([{ id: goalId, title, type, group_id: groupId }]);

  if (type === 'SCALE') {
    newGoal.subGoals = [];
    for (let sIndex = 0; sIndex < structuredData.length; sIndex++) {
      const sg = structuredData[sIndex];
      const subGoalId = `sg_${goalId}_${sIndex}`;
      await _supabase.from('sub_goals').insert([{ id: subGoalId, goal_id: goalId, title: sg.title }]);

      const taskIds = [];
      for (let tIndex = 0; tIndex < sg.tasks.length; tIndex++) {
        const t = sg.tasks[tIndex];
        const taskId = `t_${goalId}_${sIndex}_${tIndex}_${Date.now()}`;
        const pts = parseInt(t.points) || 20;

        globalState.tasks.push({ id: taskId, title: t.title, points: pts, groupId, days: t.days, goalId });
        await _supabase.from('tasks').insert([{
          id: taskId, title: t.title, points: pts, group_id: groupId, goal_id: goalId, sub_goal_id: subGoalId, days: t.days
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
        id: taskId, title: t.title, points: pts, group_id: groupId, goal_id: goalId, days: t.days
      }]);
      newGoal.directTaskIds.push(taskId);
    }
  }

  globalState.goals.push(newGoal);
}

async function deleteGoal(goalId) {
  globalState.goals = globalState.goals.filter(g => g.id !== goalId);
  globalState.tasks = globalState.tasks.filter(t => t.goalId !== goalId);
  await _supabase.from('goals').delete().eq('id', goalId);
}
