import { Injectable } from '@nestjs/common';
import { roomListDto } from './dto/events.dto';
import { createRequestDto } from './dto/events.dto.request.create.room';
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class RoomService {
  private roomList: Record<string, roomListDto>;

  constructor() {
    this.roomList = {
      'room:lobby': {
        table_no: 0,
        game_id: 'room:lobby',
        dealer_id: null,
        game_name: 'lobby',
        entry: null,
        ticket_amount: null,
        ticket_type: null,
        blind: null,
        ante: null,
        playing_users: null,
        sitout_users: null,
        status: null,
      },
    };
  }

  createGameRoom(client: Socket, request: createRequestDto): void {
    const gameId = `room:${uuidv4()}`;

    console.log(request.table_no);

    this.roomList[gameId] = {
      table_no: request.table_no,
      game_id: gameId,
      dealer_id: request.dealer_id,
      game_name: request.game_name,
      entry: request.entry,
      ticket_amount: request.ticket_amount,
      ticket_type: request.ticket_type,
      blind: request.blind,
      ante: request.ante,
      playing_users: [],
      sitout_users: [],
      status: 'playing',
    };

    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);
    client.emit('getMessage', this.roomList);
  }

  enterGameRoom(client: Socket, gameId: string) {
    console.log('get inside');
    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);

    const { nickname } = client.data;
    const { game_name } = this.getGameRoom(gameId);

    this.getGameRoom(gameId).playing_users.push(nickname);
    client.to(gameId).emit('getMessage', {
      id: null,
      nickname: '안내',
      message: `"${nickname}"님이 "${game_name}"방에 접속하셨습니다.`,
    });
  }

  exitGameRoom(client: Socket, gameId: string) {
    client.data.gameId = `room:lobby`;
    client.rooms.clear();
    client.join(`room:lobby`);

    const { nickname } = client.data;
    const playing_users = this.getGameRoom(gameId).playing_users;

    for (const i in playing_users) {
      if (playing_users[i] === nickname) playing_users.splice(Number(i), 1);
      console.log(i);
    }

    this.getGameRoom(gameId).sitout_users.push(nickname);
    client.to(gameId).emit('getMessage', {
      id: null,
      nickname: '안내',
      message: '"' + nickname + '"님이 방에서 나갔습니다.',
    });
  }

  getGameRoom(gameId: string): roomListDto {
    return this.roomList[gameId];
  }

  getGameRoomList(): Record<string, roomListDto> {
    return this.roomList;
  }

  deleteGameRoom(gameId: string) {
    delete this.roomList[gameId];
  }

  // TODO 게임종료하고 DB 연동하기
}
