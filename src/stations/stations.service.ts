import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Station } from './station.entity';
import { CreateStationDto } from './dto/create-station.dto';

export interface StationPublic {
  id: number;
  name: string;
  code: string | null;
  address: string | null;
  adminUsername: string | null;
  adminFullName: string | null;
  active: boolean;
  createdAt: Date;
}

@Injectable()
export class StationsService {
  constructor(
    @InjectRepository(Station)
    private readonly stationRepo: Repository<Station>,
  ) {}

  async findAll(): Promise<StationPublic[]> {
    const stations = await this.stationRepo.find({ order: { name: 'ASC' } });
    return stations.map(this.toPublic);
  }

  async findOne(id: number): Promise<StationPublic> {
    const s = await this.stationRepo.findOne({ where: { id } });
    if (!s) throw new NotFoundException(`Station ${id} not found`);
    return this.toPublic(s);
  }

  async findNames(): Promise<string[]> {
    const rows = await this.stationRepo.find({
      select: ['name'],
      where: { active: true },
      order: { name: 'ASC' },
    });
    return rows.map((r) => r.name);
  }

  async create(dto: CreateStationDto): Promise<StationPublic> {
    const existing = await this.stationRepo.findOne({ where: { name: dto.name.trim() } });
    if (existing) throw new ConflictException(`Station "${dto.name}" already exists`);

    const station = this.stationRepo.create({
      name: dto.name.trim(),
      code: dto.code?.trim() || null,
      address: dto.address?.trim() || null,
      adminUsername: dto.adminUsername?.trim() || null,
      adminPassword: dto.adminPassword || null,
      adminFullName: dto.adminFullName?.trim() || null,
    });
    const saved = await this.stationRepo.save(station);
    return this.toPublic(saved);
  }

  async update(id: number, dto: Partial<CreateStationDto>): Promise<StationPublic> {
    const station = await this.stationRepo.findOne({ where: { id } });
    if (!station) throw new NotFoundException(`Station ${id} not found`);

    if (dto.name !== undefined) station.name = dto.name.trim();
    if (dto.code !== undefined) station.code = dto.code?.trim() || null;
    if (dto.address !== undefined) station.address = dto.address?.trim() || null;
    if (dto.adminUsername !== undefined) station.adminUsername = dto.adminUsername?.trim() || null;
    if (dto.adminPassword !== undefined) station.adminPassword = dto.adminPassword || null;
    if (dto.adminFullName !== undefined) station.adminFullName = dto.adminFullName?.trim() || null;

    const saved = await this.stationRepo.save(station);
    return this.toPublic(saved);
  }

  async remove(id: number): Promise<void> {
    const station = await this.stationRepo.findOne({ where: { id } });
    if (!station) throw new NotFoundException(`Station ${id} not found`);
    await this.stationRepo.remove(station);
  }

  /** Used by auth service to validate station-admin login */
  async findByAdminUsername(username: string): Promise<Station | null> {
    return this.stationRepo.findOne({
      where: { adminUsername: username, active: true },
    });
  }

  /**
   * Seed all 15 Indongozi SACCO Nyamasheke branches + HQ.
   * Safe to call multiple times — skips existing stations.
   */
  async seedDemoStations(): Promise<{ created: StationPublic[]; skipped: string[] }> {
    // Indongozi SACCO Nyamasheke — HQ + 15 branches
    const branches = [
      { name: 'Nyamasheke HQ',   code: 'HQ',         address: 'Nyamasheke, Western Province', isHQ: true },
      { name: 'Bushekeri',        code: 'BSK',         address: 'Bushekeri, Nyamasheke' },
      { name: 'Bushenge',         code: 'BSG',         address: 'Bushenge, Nyamasheke' },
      { name: 'Cyato',            code: 'CYT',         address: 'Cyato, Nyamasheke' },
      { name: 'Gihombo',          code: 'GHB',         address: 'Gihombo, Nyamasheke' },
      { name: 'Kagano',           code: 'KGN',         address: 'Kagano, Nyamasheke' },
      { name: 'Kanjongo',         code: 'KJG',         address: 'Kanjongo, Nyamasheke' },
      { name: 'Karambi',          code: 'KRB',         address: 'Karambi, Nyamasheke' },
      { name: 'Karengera',        code: 'KRG',         address: 'Karengera, Nyamasheke' },
      { name: 'Kirimbi',          code: 'KRM',         address: 'Kirimbi, Nyamasheke' },
      { name: 'Macuba',           code: 'MCB',         address: 'Macuba, Nyamasheke' },
      { name: 'Mahembe',          code: 'MHB',         address: 'Mahembe, Nyamasheke' },
      { name: 'Nyabitekeri',      code: 'NBT',         address: 'Nyabitekeri, Nyamasheke' },
      { name: 'Rangiro',          code: 'RNG',         address: 'Rangiro, Nyamasheke' },
      { name: 'Ruharambuga',      code: 'RHR',         address: 'Ruharambuga, Nyamasheke' },
      { name: 'Shangi',           code: 'SHG',         address: 'Shangi, Nyamasheke' },
    ];

    const created: StationPublic[] = [];
    const skipped: string[] = [];

    for (const branch of branches) {
      const existing = await this.stationRepo.findOne({ where: { name: branch.name } });
      if (existing) {
        skipped.push(branch.name);
        continue;
      }

      // Generate portal credentials from the branch code
      const code = branch.code.toLowerCase();
      const station = this.stationRepo.create({
        name: branch.name,
        code: branch.code,
        address: branch.address,
        adminUsername: `${code}_admin`,
        adminPassword: `Indongozi@${code.toUpperCase()}`,
        adminFullName: `${branch.name} Admin`,
      });
      const saved = await this.stationRepo.save(station);
      created.push(this.toPublic(saved));
    }

    return { created, skipped };
  }

  private toPublic(s: Station): StationPublic {
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      address: s.address,
      adminUsername: s.adminUsername,
      adminFullName: s.adminFullName,
      active: s.active,
      createdAt: s.createdAt,
    };
  }
}
