import { leaveStatusLegend } from './config';
import { date, strtotime } from './php';
import { esc } from './html';

/** Shared list renderer from leave-applications.php / gate-passes.php */
export function leavesList(data: any[], todayTS?: number) {
  let out = '<ul class="list compact dividers right-assist link-list">';
  for (const row of data) {
    const overdue = todayTS !== undefined && row.status == 2 && row.time_in === null && (strtotime(row.start_date) as number) < todayTS;
    out += `<li data-url="leave-application?id=${row.id}"><div class="content${overdue ? ' error-color' : ''}"><p class="no-margin">`;
    if (row.name !== undefined) out += esc(row.name) + '<br>';
    out += date('d M Y', strtotime(row.start_date) as number);
    if (row.end_date !== null) out += ' to ' + date('d M Y', strtotime(row.end_date) as number);
    if (row.start_time !== null) out += `<br><small>${date('h:i A', strtotime(row.start_time) as number)} to ${date('h:i A', strtotime(row.end_time) as number)}</small>`;
    out += `</p></div><div class="right-assisst"><span class="badge status-${row.status}">${leaveStatusLegend[row.status]}</span></div></li>`;
  }
  return out + '</ul>';
}
