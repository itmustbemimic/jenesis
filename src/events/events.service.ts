import { Injectable } from '@nestjs/common';
import { finishGameDto, roomListDto } from './dto/events.dto';
import { createRequestDto } from './dto/events.dto';
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import { ddbClient } from '../config/ddb/ddbClient';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

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
      dealer_id: client.data.nickname,
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
    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);

    const { nickname } = client.data;
    const { game_name } = this.getGameRoom(gameId);
    const playingUsers = this.getGameRoom(gameId).playing_users;
    const sitOutUsers = this.getGameRoom(gameId).sitout_users;

    if (!playingUsers.includes(nickname)) {
      for (const i in sitOutUsers) {
        if (sitOutUsers[i] === nickname) {
          sitOutUsers.splice(Number(i), 1);
        }
      }
      playingUsers.push(nickname);
    }

    client.to(gameId).emit('getMessage', {
      id: null,
      nickname: '안내',
      message: `"${nickname}"님이 "${game_name}"방에 접속하셨습니다.`,
    });
  }

  sitoutGame(client: Socket, gameId: string, userNickname: string) {
    const playingUsers = this.getGameRoom(gameId).playing_users;

    for (const i in playingUsers) {
      if (playingUsers[i] === userNickname) {
        playingUsers.splice(Number(i), 1);
        this.getGameRoom(gameId).sitout_users.push(userNickname);
        return;
      }
    }
    client.emit(
      'getMessage',
      userNickname + '님은 플레이 중인 유저가 아닙니다.',
    );
  }

  finishGame(client: Socket, finishGameDto: finishGameDto) {
    const game = {
      TableName: process.env.GAME_TABLE_NAME,
      Item: {
        game_id: client.data.gameId,
        date: new Date().toISOString(),
        user_1st: finishGameDto.user_1st,
        user_2nd: finishGameDto.user_2nd,
        user_3rd: finishGameDto.user_3rd,
        prize_type: finishGameDto.prize_type,
        prize_amount: finishGameDto.prize_amount,
        user_list: this.getGameRoom(client.data.gameId).playing_users.concat(
          this.getGameRoom(client.data.gameId).sitout_users,
        ),
      },
    };
    const user1 = {
      TableName: process.env.USER_TABLE_NAME,
      Item: {
        user_id: finishGameDto.user_1st,
        game_id: client.data.gameId,
        point: 3,
        date: new Date().toISOString(),
        prize_type: finishGameDto.prize_type,
        prize_amount: finishGameDto.prize_amount,
      },
    };
    const user2 = {
      TableName: process.env.USER_TABLE_NAME,
      Item: {
        user_id: finishGameDto.user_2nd,
        game_id: client.data.gameId,
        point: 2,
        date: new Date().toISOString(),
        prize_type: finishGameDto.prize_type,
        prize_amount: 0,
      },
    };
    const user3 = {
      TableName: process.env.USER_TABLE_NAME,
      Item: {
        user_id: finishGameDto.user_3rd,
        game_id: client.data.gameId,
        point: 1,
        date: new Date().toISOString(),
        prize_type: finishGameDto.prize_type,
        prize_amount: 0,
      },
    };

    try {
      const data = ddbClient.send(new PutCommand(game));
      console.log('game data add success ', data);
      const data1 = ddbClient.send(new PutCommand(user1));
      console.log('user data add success ', data1);
      const data2 = ddbClient.send(new PutCommand(user2));
      console.log('user data add success ', data2);
      const data3 = ddbClient.send(new PutCommand(user3));
      console.log('user data add success ', data3);
    } catch (e) {
      client.emit('getMessage', 'insert item error. check the logs: ' + e);
      return;
    }

    //TODO 랭킹용 db 추가 하기

    this.deleteGameRoom(client.data.gameId);
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
}
