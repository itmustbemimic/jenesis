import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { RoomService } from './events.service';
import { UserGame } from '../entity/UserGame';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([UserGame])],
  providers: [EventsGateway, RoomService],
})
export class EventsModule {}
