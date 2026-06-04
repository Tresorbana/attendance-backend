import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attendance, AttendanceType } from './attendance.entity';
import { Person } from '../people/people.entity';
import { PeopleService } from '../people/people.service';

export interface AttendanceRecord {
  id: number;
  person_id: number;
  employee_id: string | null;
  name: string;
  role: string;
  station: string | null;
  timestamp: Date;
  confidence: number;
  type: AttendanceType;
}

export interface StatsResponse {
  totalPeople: number;
  todayCount: number;
  attendanceRate: number;
  lastCheckIn: Date | null;
}

/** Paired check-in / check-out for a single day */
export interface DailySession {
  person_id: number;
  employee_id: string | null;
  name: string;
  role: string;
  station: string | null;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  /** worked minutes after breaks are subtracted; null if no check-out */
  workedMinutes: number | null;
  /** total break duration in minutes (sum of all break_start→break_end pairs) */
  breakMinutes: number;
  /** delay minutes (positive = late), null if no schedule */
  delayMinutes: number | null;
  /** early departure minutes (positive = left early), null if no schedule/checkout */
  earlyDepartureMinutes: number | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
}

/** Next-action decision after a recognised scan */
export type AttendanceStage = 'checked-out' | 'checked-in' | 'on-break';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance)
    private readonly attendanceRepo: Repository<Attendance>,
    @InjectRepository(Person)
    private readonly personRepo: Repository<Person>,
    private readonly peopleService: PeopleService,
  ) {}

  async record(
    personId: number,
    confidence: number,
    type: AttendanceType = 'check-in',
  ): Promise<Attendance> {
    const entry = this.attendanceRepo.create({
      personId,
      confidence,
      type,
      timestamp: new Date(),
    });
    return this.attendanceRepo.save(entry);
  }

  /**
   * Returns the last attendance record of any type for a person.
   * Used by recognition service to determine cooldown and next action.
   */
  async getLastForPerson(personId: number): Promise<Attendance | null> {
    return this.attendanceRepo.findOne({
      where: { personId },
      order: { timestamp: 'DESC' },
    });
  }

  /**
   * Returns the last check-in record for a person today (no check-out yet).
   * Used to determine if the next scan should be a check-out.
   */
  async getOpenCheckInToday(personId: number): Promise<Attendance | null> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const lastCheckIn = await this.attendanceRepo.findOne({
      where: { personId, type: 'check-in' },
      order: { timestamp: 'DESC' },
    });

    if (!lastCheckIn || lastCheckIn.timestamp < todayStart) return null;

    // Check if there's a check-out after this check-in
    const checkOut = await this.attendanceRepo.findOne({
      where: { personId, type: 'check-out' },
      order: { timestamp: 'DESC' },
    });

    if (checkOut && checkOut.timestamp > lastCheckIn.timestamp) return null;

    return lastCheckIn;
  }

  /**
   * Compute the person's current attendance stage today.
   * Used by the recognition state machine to decide what the next scan means
   * when no explicit mode is provided.
   *
   *   checked-out  — no open check-in, or already checked out
   *   on-break     — checked in and the latest event is break-start
   *   checked-in   — checked in and not currently on break
   */
  async getCurrentStage(personId: number): Promise<AttendanceStage> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todays = await this.attendanceRepo.find({
      where: { personId },
      order: { timestamp: 'DESC' },
      take: 20,
    });
    const eventsToday = todays.filter((r) => r.timestamp >= todayStart);
    if (eventsToday.length === 0) return 'checked-out';

    const latest = eventsToday[0];
    if (latest.type === 'check-out') return 'checked-out';
    if (latest.type === 'break-start') return 'on-break';
    // check-in or break-end → working
    return 'checked-in';
  }

  /**
   * Decide the next action implied by the current stage. Used when the
   * scanner triggers a scan without an explicit mode override.
   */
  nextAction(stage: AttendanceStage): AttendanceType {
    switch (stage) {
      case 'checked-out': return 'check-in';
      case 'checked-in':  return 'check-out';
      case 'on-break':    return 'break-end';
    }
  }

  async getRecent(limit = 10, station?: string): Promise<AttendanceRecord[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'DESC')
      .take(limit);

    if (station) qb.where('person.station = :station', { station });

    const records = await qb.getMany();
    return this.formatRecords(records);
  }

  async getAll(
    from?: string,
    to?: string,
    search?: string,
    personId?: number,
    station?: string,
    type?: AttendanceType,
  ): Promise<AttendanceRecord[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'DESC')
      .take(500); // hard cap — never return unbounded results

    if (from) qb.andWhere('a.timestamp >= :from', { from: new Date(from) });
    if (to) {
      const toDate = new Date(to);
      toDate.setDate(toDate.getDate() + 1);
      qb.andWhere('a.timestamp < :to', { to: toDate });
    }
    if (personId) qb.andWhere('a.person_id = :personId', { personId });
    if (station) qb.andWhere('person.station = :station', { station });
    if (type) qb.andWhere('a.type = :type', { type });
    if (search && search.trim()) {
      // Limit search string length to prevent DoS
      const safeSearch = search.trim().slice(0, 100);
      qb.andWhere('person.name ILIKE :search', { search: `%${safeSearch}%` });
    }

    const records = await qb.getMany();
    return this.formatRecords(records);
  }

  async getStats(station?: string): Promise<StatsResponse> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [totalPeople, uniqueTodayResult, lastRecordResult] = await Promise.all([
      station
        ? this.personRepo
            .createQueryBuilder('p')
            .where('p.station = :station', { station })
            .getCount()
        : this.peopleService.count(),
      this.attendanceRepo
        .createQueryBuilder('a')
        .leftJoin('a.person', 'person')
        .select('COUNT(DISTINCT a.person_id)', 'count')
        .where('a.timestamp >= :todayStart', { todayStart })
        .andWhere("a.type = 'check-in'")
        .andWhere(station ? 'person.station = :station' : '1=1', { station })
        .getRawOne(),
      this.attendanceRepo
        .createQueryBuilder('a')
        .leftJoin('a.person', 'person')
        .where("a.type = 'check-in'")
        .andWhere(station ? 'person.station = :station' : '1=1', { station })
        .orderBy('a.timestamp', 'DESC')
        .limit(1)
        .getOne(),
    ]);

    const todayCount = parseInt(uniqueTodayResult?.count || '0', 10);
    const attendanceRate =
      totalPeople > 0 ? Math.round((todayCount / totalPeople) * 100) : 0;

    return {
      totalPeople,
      todayCount,
      attendanceRate,
      lastCheckIn: lastRecordResult?.timestamp || null,
    };
  }

  /**
   * Build daily sessions (check-in + check-out pairs) for a date range.
   * Excludes weekends and public holidays.
   */
  async getDailySessions(
    from: Date,
    to: Date,
    station?: string,
    personId?: number,
    holidayDates?: Set<string>,
  ): Promise<DailySession[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .where('a.timestamp >= :from', { from })
      .andWhere('a.timestamp <= :to', { to })
      .orderBy('a.timestamp', 'ASC');

    if (station) qb.andWhere('person.station = :station', { station });
    if (personId) qb.andWhere('a.person_id = :personId', { personId });

    const records = await qb.getMany();

    // Group by person + date
    const grouped: Record<string, Record<string, Attendance[]>> = {};
    for (const r of records) {
      const dateKey = r.timestamp.toISOString().slice(0, 10);
      const personKey = String(r.personId);
      if (!grouped[personKey]) grouped[personKey] = {};
      if (!grouped[personKey][dateKey]) grouped[personKey][dateKey] = [];
      grouped[personKey][dateKey].push(r);
    }

    const sessions: DailySession[] = [];

    for (const [, byDate] of Object.entries(grouped)) {
      for (const [dateKey, recs] of Object.entries(byDate)) {
        // Skip weekends
        const d = new Date(dateKey + 'T00:00:00');
        const dow = d.getDay(); // 0=Sun, 6=Sat
        if (dow === 0 || dow === 6) continue;
        // Skip holidays
        if (holidayDates?.has(dateKey)) continue;

        const person = recs[0].person;
        const recsByTime = [...recs].sort((a, b) => +a.timestamp - +b.timestamp);
        const checkIns  = recsByTime.filter((r) => r.type === 'check-in');
        const checkOuts = recsByTime.filter((r) => r.type === 'check-out');

        const firstIn = checkIns[0] ?? null;
        const lastOut = checkOuts[checkOuts.length - 1] ?? null;

        const checkInTime = firstIn ? this.toHHMM(firstIn.timestamp) : null;
        const checkOutTime = lastOut ? this.toHHMM(lastOut.timestamp) : null;

        // Sum break durations — pair every break-start with the next break-end
        let breakMinutes = 0;
        let openBreakStart: Date | null = null;
        for (const r of recsByTime) {
          if (r.type === 'break-start') {
            openBreakStart = r.timestamp;
          } else if (r.type === 'break-end' && openBreakStart) {
            breakMinutes += Math.max(0, Math.round((+r.timestamp - +openBreakStart) / 60000));
            openBreakStart = null;
          }
        }
        // Unclosed break (forgot to scan back) — assume break ended at check-out
        if (openBreakStart && lastOut && lastOut.timestamp > openBreakStart) {
          breakMinutes += Math.round((+lastOut.timestamp - +openBreakStart) / 60000);
        }

        let workedMinutes: number | null = null;
        if (firstIn && lastOut) {
          const rawMinutes = Math.round((+lastOut.timestamp - +firstIn.timestamp) / 60000);
          // Subtract actual recorded breaks; if there were none, fall back to a
          // 60-min lunch deduction for sessions >4h (legacy behaviour).
          if (breakMinutes > 0) {
            workedMinutes = Math.max(0, rawMinutes - breakMinutes);
          } else {
            workedMinutes = rawMinutes > 240 ? rawMinutes - 60 : rawMinutes;
          }
        }

        let delayMinutes: number | null = null;
        if (person?.scheduleStart && firstIn) {
          delayMinutes = this.minutesDiff(person.scheduleStart, checkInTime!);
        }

        let earlyDepartureMinutes: number | null = null;
        if (person?.scheduleEnd && lastOut) {
          earlyDepartureMinutes = this.minutesDiff(checkOutTime!, person.scheduleEnd);
        }

        sessions.push({
          person_id: person?.id ?? recs[0].personId,
          employee_id: person?.employeeId ?? null,
          name: person?.name ?? 'Unknown',
          role: person?.role ?? 'Unknown',
          station: person?.station ?? null,
          date: dateKey,
          checkIn: checkInTime,
          checkOut: checkOutTime,
          workedMinutes,
          breakMinutes,
          delayMinutes,
          earlyDepartureMinutes,
          scheduleStart: person?.scheduleStart ?? null,
          scheduleEnd: person?.scheduleEnd ?? null,
        });
      }
    }

    return sessions.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  }

  private toHHMM(date: Date): string {
    return date.toTimeString().slice(0, 5);
  }

  /** Returns positive if actual is later than expected (delay/early departure) */
  private minutesDiff(actual: string, expected: string): number {
    const [ah, am] = actual.split(':').map(Number);
    const [eh, em] = expected.split(':').map(Number);
    return (ah * 60 + am) - (eh * 60 + em);
  }

  private formatRecords(records: Attendance[]): AttendanceRecord[] {
    return records.map((r) => ({
      id: r.id,
      person_id: r.personId,
      employee_id: r.person?.employeeId ?? null,
      name: r.person?.name || 'Unknown',
      role: r.person?.role || 'Unknown',
      station: r.person?.station ?? null,
      timestamp: r.timestamp,
      confidence: r.confidence,
      type: r.type,
    }));
  }

  async getRawForReport(from?: Date, to?: Date): Promise<Attendance[]> {
    const qb = this.attendanceRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.person', 'person')
      .orderBy('a.timestamp', 'ASC');

    if (from) qb.andWhere('a.timestamp >= :from', { from });
    if (to) qb.andWhere('a.timestamp < :to', { to });

    return qb.getMany();
  }
}
