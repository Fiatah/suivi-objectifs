/**
 * ENGINE.JS - Moteur de données avec gestion fluide des modifications de tâches d'objectifs
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

let selectedHistoryDate = null;
let lastKnownLocalDate = getLocalDateString();

let globalState = {
  groups: [],
  tasks: [],
  goals: [],
  logs: {}
};

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function initApp() {
  await fetchStateFromSupabase();
  setInterval(checkDayChange, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDayChange();
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

// Chargement Supabase
async function fetchStateFromSupabase() {
  try {
    const [gRes, tRes, goalRes, lRes] = await Promise.all([
      _supabase.from('groups').select('*'),
      _supabase.from('tasks').select('*'),
      _supabase.from('goals').select('*'),
      _supabase.from('logs').select('*')
    ]);

    const groups = gRes.data || [];
    const tasks = tRes.data || [];
    const goalsRaw = goalRes.data || [];
    const logsRaw = lRes.data || [];

    const goals = goalsRaw.map(g => ({
      id: g.id,
      title: g.title,
      type: g.type || 'RECURRING',
      groupId: g.group_id,
      targetAmount: parseFloat(g.target_amount) || 0,
      currentAmount: parseFloat(g.current_amount) || 0,
      startDate: g.start_date || getLocalDateString(),
      dueDate: g.due_date || null,
      isCollapsed: true
    }));

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
      goalId: t.goal_id || null,
      dueDate: t.due_date || null,
      isOneTime: !!t.is_one_time,
      isFinished: !!t.is_finished,
      days: Array.isArray(t.days) ? t.days : JSON.parse(t.days || '[]')
    }));

    globalState = { groups, tasks: formattedTasks, goals, logs };
  } catch (err) {
    console.error("Erreur de chargement Supabase :", err);
  }
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

function isTaskExpired(task, targetDate = getTodayString()) {
  if (task.isFinished) return true;
  if (!task.dueDate) return false;
  return targetDate > task.dueDate;
}

function isTaskCompletedEver(taskId, beforeDate = null) {
  const st = loadState();
  const dates = Object.keys(st.logs);

  for (let d of dates) {
    if (beforeDate && d > beforeDate) continue;
    if (st.logs[d]?.[taskId]?.completed) return true;
  }
  return false;
}

function calculateGlobalScores(mode = 'daily') {
  const st = loadState();
  const datesToEvaluate = mode === 'daily' ? [getTodayString()] : getCurrentWeekDates();

  let totalRawExpected = 0, totalRawEarned = 0;
  let totalWeightedExpected = 0, totalWeightedEarned = 0;

  datesToEvaluate.forEach(dateStr => {
    const parts = dateStr.split('-');
    const dayDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const dayKeys = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const currentDayKey = dayKeys[dayDate.getDay()];
    const logs = st.logs[dateStr] || {};

    st.tasks.forEach(task => {
      if (isTaskExpired(task, dateStr)) return;
      if (task.isOneTime && isTaskCompletedEver(task.id, dateStr)) return;

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

function calculateGoalMetrics(goal) {
  const st = loadState();
  const goalTasks = st.tasks.filter(t => t.goalId === goal.id);

  if (goal.type === 'FREE_CONTRIBUTE') {
    const pct = goal.targetAmount > 0 ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100)) : 0;
    return { realPct: pct, timePct: null };
  }

  if (goal.type === 'CHAPTERS') {
    if (goalTasks.length === 0) return { realPct: 0, timePct: null };
    let done = 0;
    goalTasks.forEach(t => {
      if (t.isFinished || isTaskCompletedEver(t.id)) done++;
    });
    return { realPct: Math.round((done / goalTasks.length) * 100), timePct: null };
  }

  let completedCount = 0;
  Object.keys(st.logs).forEach(dStr => {
    goalTasks.forEach(t => {
      if (st.logs[dStr]?.[t.id]?.completed) completedCount++;
    });
  });

  let realPct = 0;
  if (goal.targetAmount > 0) {
    const valPerTask = goal.targetAmount / Math.max(1, goalTasks.length * 30);
    realPct = Math.min(100, Math.round(((completedCount * valPerTask) / goal.targetAmount) * 100));
  } else {
    realPct = goalTasks.length > 0 ? Math.min(100, Math.round((completedCount / (goalTasks.length * 30)) * 100)) : 0;
  }

  let timePct = null;
  if (goal.type === 'TIMED' && goal.startDate && goal.dueDate) {
    const start = new Date(goal.startDate).getTime();
    const end = new Date(goal.dueDate).getTime();
    const now = new Date(getLocalDateString()).getTime();

    if (end > start) {
      const totalDuration = end - start;
      const elapsed = Math.max(0, now - start);
      timePct = Math.min(100, Math.round((elapsed / totalDuration) * 100));
    }
  }

  return { realPct, timePct };
}

function toggleGoalAccordion(goalId) {
  const goal = globalState.goals.find(g => g.id === goalId);
  if (goal) {
    goal.isCollapsed = !goal.isCollapsed;
    renderUI();
  }
}

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
    await _supabase.from('logs').upsert({ date_str: dateStr, task_id: taskId, points: pts, completed: true }, { onConflict: 'date_str,task_id' });
  }
}

async function finishTaskPermanently(taskId) {
  const task = globalState.tasks.find(t => t.id === taskId);
  if (task) {
    task.isFinished = true;
    await _supabase.from('tasks').update({ is_finished: true }).eq('id', taskId);
  }
}

// CRUD TÂCHES (Gestion unifiée sans blocage)
async function addStandaloneTask(title, points, groupId, daysArray, dueDate = null, goalId = null, isOneTime = false) {
  const id = 'task_' + Date.now();
  const days = daysArray || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const pts = parseInt(points) || 10;

  globalState.tasks.push({ id, title, points: pts, groupId, days, dueDate: dueDate || null, goalId, isOneTime, isFinished: false });
  await _supabase.from('tasks').insert([{ id, title, points: pts, group_id: groupId, days, due_date: dueDate || null, goal_id: goalId, is_one_time: isOneTime, is_finished: false }]);
}

async function updateTask(taskId, newTitle, newPoints, newGroupId, newDays, newDueDate, newIsOneTime) {
  const pts = parseInt(newPoints) || 10;
  const task = globalState.tasks.find(t => t.id === taskId);
  
  if (task) {
    task.title = newTitle;
    task.points = pts;
    task.groupId = newGroupId;
    task.days = newDays;
    task.dueDate = newDueDate || null;
    task.isOneTime = newIsOneTime;
  }

  await _supabase.from('tasks').update({
    title: newTitle,
    points: pts,
    group_id: newGroupId,
    days: newDays,
    due_date: newDueDate || null,
    is_one_time: newIsOneTime
  }).eq('id', taskId);
}

async function deleteTask(taskId) {
  globalState.tasks = globalState.tasks.filter(t => t.id !== taskId);
  await _supabase.from('tasks').delete().eq('id', taskId);
}

// CRUD OBJECTIFS
async function addGoal(title, type, groupId, targetAmount, dueDate, taskTitle, taskPoints, taskDueDate = null) {
  const goalId = 'goal_' + Date.now();
  const startDate = getLocalDateString();
  const target = parseFloat(targetAmount) || 0;

  const newGoal = {
    id: goalId,
    title,
    type,
    groupId,
    targetAmount: target,
    currentAmount: 0,
    startDate,
    dueDate: dueDate || null,
    isCollapsed: false
  };

  globalState.goals.push(newGoal);
  await _supabase.from('goals').insert([{
    id: goalId,
    title,
    type,
    group_id: groupId,
    target_amount: target,
    current_amount: 0,
    start_date: startDate,
    due_date: dueDate || null
  }]);

  if (taskTitle && type !== 'FREE_CONTRIBUTE') {
    const isOneTime = type === 'CHAPTERS';
    const effectiveTaskDueDate = taskDueDate || dueDate || null;
    await addStandaloneTask(taskTitle, taskPoints || 20, groupId, ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], effectiveTaskDueDate, goalId, isOneTime);
  }
}

async function updateGoal(goalId, newTitle, newGroupId, newType, newTargetAmount, newDueDate) {
  const goal = globalState.goals.find(g => g.id === goalId);
  if (!goal) return;

  const oldGroupId = goal.groupId;
  goal.title = newTitle;
  goal.groupId = newGroupId;
  goal.type = newType;
  goal.targetAmount = parseFloat(newTargetAmount) || 0;
  goal.dueDate = newDueDate || null;

  await _supabase.from('goals').update({
    title: newTitle,
    group_id: newGroupId,
    type: newType,
    target_amount: parseFloat(newTargetAmount) || 0,
    due_date: newDueDate || null
  }).eq('id', goalId);

  if (oldGroupId !== newGroupId) {
    globalState.tasks.forEach(t => {
      if (t.goalId === goalId) {
        t.groupId = newGroupId;
      }
    });
    await _supabase.from('tasks').update({ group_id: newGroupId }).eq('goal_id', goalId);
  }
}

async function deleteGoal(goalId) {
  globalState.goals = globalState.goals.filter(g => g.id !== goalId);
  globalState.tasks = globalState.tasks.filter(t => t.goalId !== goalId);
  await _supabase.from('goals').delete().eq('id', goalId);
}

// GROUPES
async function addGroup(name, icon, weight = 1) {
  const id = 'g_' + Date.now();
  globalState.groups.push({ id, name, icon: icon || '📁', weight: parseInt(weight) || 1 });
  await _supabase.from('groups').insert([{ id, name, icon: icon || '📁', weight: parseInt(weight) || 1 }]);
}

async function deleteGroup(groupId) {
  globalState.groups = globalState.groups.filter(g => g.id !== groupId);
  globalState.tasks = globalState.tasks.filter(t => t.groupId !== groupId);
  globalState.goals = globalState.goals.filter(g => g.groupId !== groupId);
  await _supabase.from('groups').delete().eq('id', groupId);
}

async function updateGroupWeight(groupId, newWeight) {
  const weight = Math.max(1, parseInt(newWeight) || 1);
  const group = globalState.groups.find(g => g.id === groupId);
  if (group) group.weight = weight;
  await _supabase.from('groups').update({ weight }).eq('id', groupId);
}
