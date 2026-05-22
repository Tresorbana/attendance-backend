import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Person } from './people.entity';
import { PeopleService } from './people.service';
import { PeopleController, EnrollController } from './people.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Person])],
  providers: [PeopleService],
  controllers: [PeopleController, EnrollController],
  exports: [PeopleService],
})
export class PeopleModule {}
