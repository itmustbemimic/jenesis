import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { RoomService } from './events.service';

@Module({
  providers: [EventsGateway, RoomService],
})
export class EventsModule {}
