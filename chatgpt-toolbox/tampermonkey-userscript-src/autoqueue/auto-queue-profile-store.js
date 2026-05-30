  /********************************************************************
   * AutoQueueProfileStore：任务组与任务项（委托 auto-queue-core）
   ********************************************************************/

  const AutoQueueProfileStore = (() => {
    function create(deps) {
      const {
        log,
        legacyNormalizeListProfiles,
        legacyGetActiveListProfile,
        legacyCreateDefaultTaskProfileDefaults,
        legacyCreateDefaultTaskItem,
        legacyAddTask,
        legacyUpdateTask,
        legacyDeleteTask,
        legacyReorderTask,
        legacyGetTaskById,
        legacyGetNextRunnableTask,
        legacyMarkTaskDone,
      } = deps;

      function appendProfileLog(message) {
        if (typeof log === 'function') {
          log(message);
        }
      }

      function wrap(name, fn, args) {
        if (typeof fn !== 'function') {
          appendProfileLog(`[AUTO_QUEUE_PROFILE][MISSING] op=${name}`);
          return null;
        }
        return fn.apply(null, args);
      }

      return {
        normalizeListProfiles: (...args) => wrap('normalizeListProfiles', legacyNormalizeListProfiles, args),
        getActiveListProfile: (...args) => wrap('getActiveListProfile', legacyGetActiveListProfile, args),
        createDefaultTaskProfileDefaults: (...args) => wrap('createDefaultTaskProfileDefaults', legacyCreateDefaultTaskProfileDefaults, args),
        createDefaultTaskItem: (...args) => wrap('createDefaultTaskItem', legacyCreateDefaultTaskItem, args),
        addTask: (...args) => wrap('addTask', legacyAddTask, args),
        updateTask: (...args) => wrap('updateTask', legacyUpdateTask, args),
        deleteTask: (...args) => wrap('deleteTask', legacyDeleteTask, args),
        reorderTask: (...args) => wrap('reorderTask', legacyReorderTask, args),
        getTaskById: (...args) => wrap('getTaskById', legacyGetTaskById, args),
        getNextRunnableTask: (...args) => wrap('getNextRunnableTask', legacyGetNextRunnableTask, args),
        markTaskDone: (...args) => wrap('markTaskDone', legacyMarkTaskDone, args),
      };
    }

    return { create };
  })();
