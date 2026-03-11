export function computeNextOccurrence(timeStr, fromDate = new Date()) {
  const [hh, mm] = timeStr.split(':').map(Number);
  const target = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate(),
    hh,
    mm,
    0,
    0
  );
  if (target <= fromDate) target.setDate(target.getDate() + 1);
  return target;
}

export function scheduleDailyEvents(times, onTrigger) {
  const timerIds = [];

  times.forEach((timeStr) => {
    const next = computeNextOccurrence(timeStr);
    const delay = next.getTime() - Date.now();
    const id = setTimeout(function trigger() {
      onTrigger(timeStr);
      const nextId = setTimeout(trigger, 24 * 60 * 60 * 1000);
      timerIds.push(nextId);
    }, delay);
    timerIds.push(id);
  });

  return timerIds;
}

export function clearScheduledEvents(timerIds) {
  timerIds.forEach((id) => clearTimeout(id));
  timerIds.length = 0;
}