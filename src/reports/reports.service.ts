import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attendance } from '../attendance/attendance.entity';
import { PeopleService } from '../people/people.service';
import { AttendanceService, DailySession } from '../attendance/attendance.service';
import { HolidaysService } from '../holidays/holidays.service';

export interface HourlyBucket {
  hour: number;
  count: number;
  label: string;
}

export interface DailyBucket {
  date: string;
  count: number;
  label: string;
}

export interface PresentToday {
  present: number;
  total: number;
  absent: number;
}

export interface RoleBucket {
  role: string;
  count: number;
}

export interface CalendarDay {
  date: string;
  count: number;
}

export interface MonthlyEmployeeRow {
  person_id: number;
  employee_id: string | null;
  name: string;
  role: string;
  station: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  /** Total working days in the month (excl. weekends + holidays) */
  requiredDays: number;
  /** Days the employee was present */
  presentDays: number;
  /** Days absent */
  absentDays: number;
  /** Total worked minutes */
  totalWorkedMinutes: number;
  /** Required minutes (requiredDays × daily schedule minutes) */
  requiredMinutes: number;
  /** Deficit minutes (negative = worked less than required) */
  deficitMinutes: number;
  /** Number of days late */
  lateDays: number;
  /** Total delay minutes */
  totalDelayMinutes: number;
  /** Number of days with early departure */
  earlyDepartureDays: number;
  sessions: DailySession[];
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    private readonly peopleService: PeopleService,
    private readonly attendanceService: AttendanceService,
    private readonly holidaysService: HolidaysService,
  ) {}

  private todayBounds() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  async daily(): Promise<HourlyBucket[]> {
    const { start, end } = this.todayBounds();

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select('EXTRACT(HOUR FROM a.timestamp)::int', 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere('a.timestamp <= :end', { end })
      .andWhere("a.type = 'check-in'")
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany();

    const countByHour: Record<number, number> = {};
    for (const row of rows) {
      countByHour[Number(row.hour)] = parseInt(row.count, 10);
    }

    const buckets: HourlyBucket[] = [];
    for (let h = 0; h < 24; h++) {
      const period = h < 12 ? 'AM' : 'PM';
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      buckets.push({ hour: h, count: countByHour[h] || 0, label: `${displayHour}:00 ${period}` });
    }
    return buckets;
  }

  async weekly(): Promise<DailyBucket[]> {
    return this.buildDailyBuckets(7);
  }

  async monthly(): Promise<DailyBucket[]> {
    return this.buildDailyBuckets(30);
  }

  async presentToday(station?: string): Promise<PresentToday> {
    const { start } = this.todayBounds();

    const totalQb = this.attendanceRepo.manager
      .getRepository('people')
      .createQueryBuilder('p');
    if (station) totalQb.where('p.station = :station', { station });
    const total = await totalQb.getCount();

    const presentQb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoin('a.person', 'person')
      .select('COUNT(DISTINCT a.person_id)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere("a.type = 'check-in'");
    if (station) presentQb.andWhere('person.station = :station', { station });

    const presentResult = await presentQb.getRawOne();
    const present = parseInt(presentResult?.count || '0', 10);
    return { present, total, absent: Math.max(0, total - present) };
  }

  async byRole(): Promise<RoleBucket[]> {
    const { start } = this.todayBounds();
    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoin('a.person', 'person')
      .select('person.role', 'role')
      .addSelect('COUNT(DISTINCT a.person_id)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere("a.type = 'check-in'")
      .groupBy('person.role')
      .orderBy('count', 'DESC')
      .getRawMany();
    return rows.map((r) => ({ role: r.role || 'Unknown', count: parseInt(r.count, 10) }));
  }

  async calendarMonth(year: number, month: number): Promise<CalendarDay[]> {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const daysInMonth = end.getDate();

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select("TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(DISTINCT a.person_id)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere('a.timestamp <= :end', { end })
      .andWhere("a.type = 'check-in'")
      .groupBy('date')
      .getRawMany();

    const countByDate: Record<string, number> = {};
    for (const row of rows) {
      countByDate[row.date] = parseInt(row.count, 10);
    }

    const result: CalendarDay[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      result.push({ date: dateStr, count: countByDate[dateStr] || 0 });
    }
    return result;
  }

  /**
   * Monthly working-hours report per employee.
   * Excludes weekends and public holidays.
   * Groups by station if provided.
   */
  async monthlyWorkingHours(
    year: number,
    month: number,
    station?: string,
    personId?: number,
  ): Promise<MonthlyEmployeeRow[]> {
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const holidayDates = await this.holidaysService.getHolidayDates(from, to);
    const sessions = await this.attendanceService.getDailySessions(
      from,
      to,
      station,
      personId,
      holidayDates,
    );

    // Count required working days in the month
    const requiredDays = this.countWorkingDays(year, month, holidayDates);

    // Group sessions by person
    const byPerson: Record<number, DailySession[]> = {};
    for (const s of sessions) {
      if (!byPerson[s.person_id]) byPerson[s.person_id] = [];
      byPerson[s.person_id].push(s);
    }

    const rows: MonthlyEmployeeRow[] = [];

    for (const [, personSessions] of Object.entries(byPerson)) {
      const first = personSessions[0];
      const scheduleMinutes = this.scheduleMinutes(first.scheduleStart, first.scheduleEnd);

      const presentDays = personSessions.length;
      const totalWorkedMinutes = personSessions.reduce(
        (sum, s) => sum + (s.workedMinutes ?? 0),
        0,
      );
      const requiredMinutes = scheduleMinutes * requiredDays;
      const deficitMinutes = totalWorkedMinutes - requiredMinutes;

      const lateDays = personSessions.filter(
        (s) => s.delayMinutes !== null && s.delayMinutes > 0,
      ).length;
      const totalDelayMinutes = personSessions.reduce(
        (sum, s) => sum + (s.delayMinutes !== null && s.delayMinutes > 0 ? s.delayMinutes : 0),
        0,
      );
      const earlyDepartureDays = personSessions.filter(
        (s) => s.earlyDepartureMinutes !== null && s.earlyDepartureMinutes > 0,
      ).length;

      rows.push({
        person_id: first.person_id,
        employee_id: first.employee_id,
        name: first.name,
        role: first.role,
        station: first.station,
        scheduleStart: first.scheduleStart,
        scheduleEnd: first.scheduleEnd,
        requiredDays,
        presentDays,
        absentDays: Math.max(0, requiredDays - presentDays),
        totalWorkedMinutes,
        requiredMinutes,
        deficitMinutes,
        lateDays,
        totalDelayMinutes,
        earlyDepartureDays,
        sessions: personSessions,
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Count working days in a month (Mon–Fri, excluding holidays) */
  private countWorkingDays(year: number, month: number, holidayDates: Set<string>): number {
    const daysInMonth = new Date(year, month, 0).getDate();
    let count = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month - 1, d);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue;
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (holidayDates.has(key)) continue;
      count++;
    }
    return count;
  }

  private scheduleMinutes(start: string | null, end: string | null): number {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return (eh * 60 + em) - (sh * 60 + sm);
  }

  private async buildDailyBuckets(days: number): Promise<DailyBucket[]> {
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);

    const rows = await this.attendanceRepo
      .createQueryBuilder('a')
      .select("TO_CHAR(a.timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD')", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('a.timestamp >= :start', { start })
      .andWhere("a.type = 'check-in'")
      .groupBy('date')
      .orderBy('date', 'ASC')
      .getRawMany();

    const countByDate: Record<string, number> = {};
    for (const row of rows) {
      countByDate[row.date] = parseInt(row.count, 10);
    }

    const buckets: DailyBucket[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      buckets.push({ date: key, count: countByDate[key] || 0, label });
    }
    return buckets;
  }

  async exportCsv(from?: string, to?: string): Promise<string> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'ASC');

    if (from) qb.andWhere('a.timestamp >= :from', { from: new Date(from) });
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      qb.andWhere('a.timestamp < :to', { to: toDate });
    }

    const records = await qb.getMany();
    const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
    const period = from || to ? `${from || 'all time'} to ${to || 'today'}` : 'all records';

    const summary = [
      `"Staff Attendance Management System (SAMS) — Attendance Report"`,
      `"Generated","${generatedAt}"`,
      `"Period","${period}"`,
      `"Total records","${records.length}"`,
      ``,
    ].join('\r\n');

    const header = `Date,Employee ID,Employee Name,Role,Station,Type,Time`;
    const rows = records.map((r) => {
      const empId = (r.person?.employeeId || '').replace(/"/g, '""');
      const name = (r.person?.name || '').replace(/"/g, '""');
      const role = (r.person?.role || '').replace(/"/g, '""');
      const station = (r.person?.station || '').replace(/"/g, '""');
      const ts = r.timestamp ? new Date(r.timestamp) : null;
      const date = ts ? ts.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
      const time = ts ? ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
      return `${date},"${empId}","${name}","${role}","${station}",${r.type},${time}`;
    });

    return summary + header + '\r\n' + rows.join('\r\n');
  }

  /** Export monthly working hours report as CSV */
  async exportMonthlyWorkingHoursCsv(
    year: number,
    month: number,
    station?: string,
  ): Promise<string> {
    const rows = await this.monthlyWorkingHours(year, month, station);
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const generatedAt = new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });

    const summary = [
      `"Staff Attendance Management System (SAMS)"`,
      `"Monthly Working Hours Report — ${monthName}"`,
      station ? `"Station","${station}"` : `"Station","All Stations"`,
      `"Generated","${generatedAt}"`,
      ``,
    ].join('\r\n');

    const header = [
      'Employee ID',
      'Name',
      'Role',
      'Station',
      'Schedule',
      'Required Days',
      'Present Days',
      'Absent Days',
      'Required Hours',
      'Worked Hours',
      'Deficit Hours',
      'Late Days',
      'Total Delay (min)',
      'Early Departure Days',
    ].join(',');

    const dataRows = rows.map((r) => {
      const schedule =
        r.scheduleStart && r.scheduleEnd ? `${r.scheduleStart}-${r.scheduleEnd}` : 'N/A';
      const reqHours = (r.requiredMinutes / 60).toFixed(1);
      const workedHours = (r.totalWorkedMinutes / 60).toFixed(1);
      const deficitHours = (r.deficitMinutes / 60).toFixed(1);
      return [
        `"${r.employee_id || ''}"`,
        `"${r.name}"`,
        `"${r.role}"`,
        `"${r.station || ''}"`,
        `"${schedule}"`,
        r.requiredDays,
        r.presentDays,
        r.absentDays,
        reqHours,
        workedHours,
        deficitHours,
        r.lateDays,
        r.totalDelayMinutes,
        r.earlyDepartureDays,
      ].join(',');
    });

    return summary + header + '\r\n' + dataRows.join('\r\n');
  }
}
