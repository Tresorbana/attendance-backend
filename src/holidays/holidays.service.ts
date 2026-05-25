import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Holiday } from './holiday.entity';

export interface CreateHolidayDto {
  name: string;
  date: string;
  confirmed?: boolean;
}

@Injectable()
export class HolidaysService {
  constructor(
    @InjectRepository(Holiday)
    private readonly holidayRepo: Repository<Holiday>,
  ) {}

  async findAll(): Promise<Holiday[]> {
    return this.holidayRepo.find({ order: { date: 'ASC' } });
  }

  async findByYear(year: number): Promise<Holiday[]> {
    return this.holidayRepo
      .createQueryBuilder('h')
      .where('h.date LIKE :prefix', { prefix: `${year}-%` })
      .orderBy('h.date', 'ASC')
      .getMany();
  }

  async getHolidayDates(from: Date, to: Date): Promise<Set<string>> {
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);
    const rows = await this.holidayRepo
      .createQueryBuilder('h')
      .where('h.date >= :from', { from: fromStr })
      .andWhere('h.date <= :to', { to: toStr })
      .getMany();
    return new Set(rows.map((h) => h.date));
  }

  async create(dto: CreateHolidayDto): Promise<Holiday> {
    const holiday = this.holidayRepo.create({
      name: dto.name.trim(),
      date: dto.date,
      confirmed: dto.confirmed ?? false,
    });
    return this.holidayRepo.save(holiday);
  }

  async update(id: number, dto: Partial<CreateHolidayDto>): Promise<Holiday> {
    const holiday = await this.holidayRepo.findOne({ where: { id } });
    if (!holiday) throw new NotFoundException(`Holiday ${id} not found`);
    if (dto.name !== undefined) holiday.name = dto.name.trim();
    if (dto.date !== undefined) holiday.date = dto.date;
    if (dto.confirmed !== undefined) holiday.confirmed = dto.confirmed;
    return this.holidayRepo.save(holiday);
  }

  async remove(id: number): Promise<void> {
    const holiday = await this.holidayRepo.findOne({ where: { id } });
    if (!holiday) throw new NotFoundException(`Holiday ${id} not found`);
    await this.holidayRepo.remove(holiday);
  }

  /**
   * Seed Rwanda official public holidays for a given year.
   * Safe to call multiple times — skips if holidays already exist for that year.
   *
   * Fixed dates are confirmed=true.
   * Islamic holidays (Eid al-Fitr, Eid al-Adha) are confirmed=false (tentative)
   * because their exact dates depend on moon sighting and shift each year.
   */
  async seedDefaults(year: number): Promise<void> {
    const existing = await this.findByYear(year);
    if (existing.length > 0) return;

    // ── Islamic holiday dates (approximate — vary by moon sighting) ──────────
    // These are pre-calculated estimates. Admins should confirm/adjust via UI.
    const islamicDates = this.getIslamicHolidayDates(year);

    const defaults: CreateHolidayDto[] = [
      // ── January ────────────────────────────────────────────────────────────
      { name: "New Year's Day", date: `${year}-01-01`, confirmed: true },
      { name: 'Day after New Year\'s Day', date: `${year}-01-02`, confirmed: true },

      // ── February ───────────────────────────────────────────────────────────
      // National Heroes' Day — February 1 (observed Feb 2 if on weekend)
      { name: "National Heroes' Day", date: this.observedDate(year, 2, 1), confirmed: true },

      // ── Islamic: Eid al-Fitr (end of Ramadan) ──────────────────────────────
      { name: 'Eid al-Fitr (End of Ramadan)', date: islamicDates.eidAlFitr, confirmed: false },

      // ── April ──────────────────────────────────────────────────────────────
      { name: 'Good Friday', date: this.getGoodFriday(year), confirmed: true },
      { name: 'Easter Monday', date: this.getEasterMonday(year), confirmed: true },
      // Genocide Against the Tutsi Memorial Day — April 7
      { name: 'Genocide Against the Tutsi Memorial Day', date: `${year}-04-07`, confirmed: true },

      // ── May ────────────────────────────────────────────────────────────────
      { name: 'Labour Day (Worker\'s Day)', date: `${year}-05-01`, confirmed: true },

      // ── Islamic: Eid al-Adha (Feast of Sacrifice) ──────────────────────────
      { name: 'Eid al-Adha (Feast of Sacrifice)', date: islamicDates.eidAlAdha, confirmed: false },

      // ── July ───────────────────────────────────────────────────────────────
      { name: 'Independence Day', date: `${year}-07-01`, confirmed: true },
      // Liberation Day (Kwibohora) — July 4
      { name: 'Liberation Day (Kwibohora)', date: `${year}-07-04`, confirmed: true },

      // ── August ─────────────────────────────────────────────────────────────
      // Umuganura Day — first Friday of August
      { name: 'Umuganura Day (National Thanksgiving)', date: this.getFirstFridayOfAugust(year), confirmed: true },
      { name: 'Assumption Day', date: `${year}-08-15`, confirmed: true },

      // ── December ───────────────────────────────────────────────────────────
      { name: 'Christmas Day', date: `${year}-12-25`, confirmed: true },
      { name: 'Boxing Day', date: `${year}-12-26`, confirmed: true },
    ];

    for (const d of defaults) {
      try {
        await this.create(d);
      } catch {
        // ignore duplicate key errors (unique constraint on date)
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * If a fixed holiday falls on a Saturday, observe on Monday.
   * If it falls on a Sunday, observe on Monday.
   * Rwanda typically observes on the next Monday.
   */
  private observedDate(year: number, month: number, day: number): string {
    const d = new Date(year, month - 1, day);
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 6) d.setDate(d.getDate() + 2); // Sat → Mon
    else if (dow === 0) d.setDate(d.getDate() + 1); // Sun → Mon
    return d.toISOString().slice(0, 10);
  }

  /** First Friday of August */
  private getFirstFridayOfAugust(year: number): string {
    const d = new Date(year, 7, 1); // August 1
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1); // advance to Friday
    return d.toISOString().slice(0, 10);
  }

  /**
   * Approximate Islamic holiday dates using the Hijri calendar offset.
   * These are estimates — the actual dates depend on moon sighting.
   * Admins should verify and confirm via the Holidays UI.
   *
   * Reference offsets from known dates:
   *   Eid al-Fitr 2026: ~March 20
   *   Eid al-Adha 2026: ~May 27
   *   Each year shifts back ~11 days in the Gregorian calendar.
   */
  private getIslamicHolidayDates(year: number): {
    eidAlFitr: string;
    eidAlAdha: string;
  } {
    // Base year 2026 known dates
    const BASE_YEAR = 2026;
    const BASE_EID_FITR = new Date(2026, 2, 20);  // March 20, 2026
    const BASE_EID_ADHA = new Date(2026, 4, 27);  // May 27, 2026
    const DAYS_PER_HIJRI_YEAR = 354.367; // average Hijri year in days

    const yearDiff = year - BASE_YEAR;
    const dayOffset = Math.round(yearDiff * DAYS_PER_HIJRI_YEAR);

    const eidFitr = new Date(BASE_EID_FITR);
    eidFitr.setDate(eidFitr.getDate() + dayOffset);

    const eidAdha = new Date(BASE_EID_ADHA);
    eidAdha.setDate(eidAdha.getDate() + dayOffset);

    return {
      eidAlFitr: eidFitr.toISOString().slice(0, 10),
      eidAlAdha: eidAdha.toISOString().slice(0, 10),
    };
  }

  private getGoodFriday(year: number): string {
    const easter = this.computeEaster(year);
    const gf = new Date(easter);
    gf.setDate(gf.getDate() - 2);
    return gf.toISOString().slice(0, 10);
  }

  private getEasterMonday(year: number): string {
    const easter = this.computeEaster(year);
    const em = new Date(easter);
    em.setDate(em.getDate() + 1);
    return em.toISOString().slice(0, 10);
  }

  /** Anonymous Gregorian algorithm for Easter Sunday */
  private computeEaster(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
  }
}
