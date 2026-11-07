const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function relativeDate(seconds: number): string {
  if (!seconds) {
    return '';
  }
  const delta = Math.max(0, Date.now() / 1000 - seconds);
  if (delta < 60) {
    return 'now';
  }
  if (delta < 3600) {
    return `${Math.floor(delta / 60)}m`;
  }
  if (delta < 86400) {
    return `${Math.floor(delta / 3600)}h`;
  }
  if (delta < 86400 * 7) {
    return `${Math.floor(delta / 86400)}d`;
  }
  if (delta < 86400 * 35) {
    return `${Math.floor(delta / (86400 * 7))}w`;
  }
  return formatDate(seconds);
}

export function formatDate(seconds: number): string {
  if (!seconds) {
    return '';
  }
  const date = new Date(seconds * 1000);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const base = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return sameYear ? base : `${base}, ${date.getFullYear()}`;
}

export function formatDateTime(seconds: number): string {
  if (!seconds) {
    return '';
  }
  const date = new Date(seconds * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
