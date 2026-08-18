// ==========================================
// PERSISTANCE & ACTIONS TÂCHES (SUPABASE)
// ==========================================

// 1. Mise à jour complète d'une tâche dans Supabase
async function updateTask(taskId, title, points, groupId, days, dueDate, isOneTime, goalId = null) {
  const payload = {
    title: title,
    points: parseInt(points, 10),
    group_id: groupId,
    days: days,
    due_date: dueDate || null,
    is_one_time: isOneTime,
    goal_id: goalId || null
  };

  // 1. Enregistrement local immédiat
  const task = state.tasks.find(t => t.id === taskId);
  if (task) {
    task.title = title;
    task.points = parseInt(points, 10);
    task.groupId = groupId;
    task.days = days;
    task.dueDate = dueDate || null;
    task.isOneTime = isOneTime;
    task.goalId = goalId || null;
    saveStateLocal(state);
  }

  // 2. Requête UPDATE explicite vers Supabase
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('tasks')
        .update(payload)
        .eq('id', taskId);

      if (error) console.error("Erreur mise à jour Supabase (Task):", error);
    } catch (err) {
      console.error("Échec de connexion Supabase lors de updateTask:", err);
    }
  }

  // 3. Resynchronisation de l'état global
  await syncWithSupabase();
}

// 2. Mise à jour complète d'un objectif dans Supabase
async function updateGoal(goalId, title, groupId, type, targetAmount, dueDate) {
  const payload = {
    title: title,
    group_id: groupId,
    type: type,
    target_amount: targetAmount ? parseFloat(targetAmount) : null,
    due_date: dueDate || null
  };

  // 1. Enregistrement local
  const goal = state.goals.find(g => g.id === goalId);
  if (goal) {
    goal.title = title;
    goal.groupId = groupId;
    goal.type = type;
    goal.targetAmount = targetAmount ? parseFloat(targetAmount) : null;
    goal.dueDate = dueDate || null;
    saveStateLocal(state);
  }

  // 2. Enregistrement Supabase
  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('goals')
        .update(payload)
        .eq('id', goalId);

      if (error) console.error("Erreur mise à jour Supabase (Goal):", error);
    } catch (err) {
      console.error("Échec de connexion Supabase lors de updateGoal:", err);
    }
  }

  await syncWithSupabase();
}
