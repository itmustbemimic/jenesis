import { Injectable } from '@nestjs/common';
import { finishGameDto, roomListDto } from './dto/events.dto';
import { createRoomRequestDto } from './dto/events.dto';
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ddbClient } from '../config/ddb/ddbClient';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { InjectRepository } from '@nestjs/typeorm';
import { UserGame } from '../entity/UserGame';
import { Repository } from 'typeorm';

@Injectable()
export class RoomService {
  private readonly roomList: Record<string, roomListDto>;

  constructor(
    @InjectRepository(UserGame)
    private userGameRepository: Repository<UserGame>,
  ) {
    this.roomList = {};
  }

  createGameRoom(client: Socket, request: createRoomRequestDto): void {
    const gameId = `room:${uuidv4()}`;

    for (const i in this.roomList) {
      if (this.roomList[i].table_no === request.table_no) {
        client.emit('error', {
          type: 'createGameRoom',
          msg: '테이블이 이미 사용중입니다.',
        });
        client.emit('getMessage', this.roomList);
        return;
      }
    }

    this.roomList[gameId] = {
      table_no: request.table_no,
      game_id: gameId,
      dealer_id: client.data.nickname,
      game_name: request.game_name,
      entry_limit: request.entry_limit,
      entry: 0,
      ticket_amount: request.ticket_amount,
      ticket_type: request.ticket_type,
      duration: request.duration,
      blind: request.blind,
      ante: request.ante,
      playing_users: {},
      sitout_users: {},
      status: request.status,
    };

    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);
    client.emit('getMessage', this.roomList);
  }

  enterGameRoom(client: Socket, gameId: string) {
    const { nickname, uuid } = client.data;
    const { playing_users, dealer_id, entry, entry_limit } =
      this.getGameRoom(gameId);

    if (entry_limit <= entry && dealer_id !== client.data.nickname) {
      client.emit('error', { type: 'enterGameRoom', msg: '엔트리 꽉참' });
      return;
    }

    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);

    if (!playing_users[nickname] && dealer_id !== client.data.nickname) {
      playing_users[nickname] = uuid;
      this.getGameRoom(gameId).entry++;
      client.to(gameId).emit('getMessage', nickname + ' 게임 참가');
    }
  }

  sitoutGame(client: Socket, gameId: string, userNickname: string) {
    const { playing_users, sitout_users } = this.getGameRoom(gameId);

    if (!playing_users[userNickname]) {
      client.emit('error', {
        type: 'sitout',
        msg: userNickname + '님은 플레이 중인 유저가 아닙니다.',
      });
    } else {
      sitout_users[userNickname] = playing_users[userNickname];
      delete playing_users[userNickname];
      client.to(gameId).emit('getMessage', userNickname + 'sitout');
    }
  }

  finishGame(client: Socket, finishGameDto: finishGameDto) {
    const { playing_users, sitout_users } = this.getGameRoom(
      client.data.gameId,
    );

    if (
      client.data.gameId === 'room:lobby' ||
      this.getGameRoom(client.data.gameId).dealer_id !== client.data.nickname
    ) {
      client.emit('error', {
        type: 'finishGame',
        msg: '게임에 속해 있지 않거나, 해당 게임의 딜러가 아닙니다.',
      });
      return;
    }

    const now: string = new Date().toISOString();
    const game = {
      TableName: process.env.GAME_TABLE_NAME,
      Item: {
        game_id: client.data.gameId,
        game_date: now,
        user_1st: finishGameDto.user_1st,
        user_2nd: finishGameDto.user_2nd,
        user_3rd: finishGameDto.user_3rd,
        prize_type: finishGameDto.prize_type,
        prize_amount: finishGameDto.prize_amount,
        user_list: {
          ...playing_users,
          ...sitout_users,
        },
      },
    };
    const user1 = {
      user_uuid: finishGameDto.user_1st,
      game_id: client.data.gameId,
      game_date: now,
      place: 1,
      point: 3,
      prize_type: finishGameDto.prize_type,
      prize_amount: finishGameDto.prize_amount,
    };
    const user2 = {
      user_uuid: finishGameDto.user_2nd,
      game_id: client.data.gameId,
      game_date: now,
      place: 2,
      point: 2,
      prize_type: finishGameDto.prize_type,
      prize_amount: 0,
    };
    const user3 = {
      user_uuid: finishGameDto.user_3rd,
      game_id: client.data.gameId,
      game_date: now,
      place: 3,
      point: 1,
      prize_type: finishGameDto.prize_type,
      prize_amount: 0,
    };

    // for test
    this.deleteGameRoom(client);

    try {
      this.userGameRepository
        .insert(user1)
        .then((r) => console.log('1st user data inserted'));
      this.userGameRepository
        .insert(user2)
        .then((r) => console.log('2nd user data inserted'));
      this.userGameRepository
        .insert(user3)
        .then((r) => console.log('3rd user data inserted'));
      ddbClient
        .send(new PutCommand(game))
        .then((data) => console.log('game data add success '));
    } catch (e) {
      client.emit('error', {
        type: 'finishGame',
        msg: 'insert item error. try again and check the logs: ' + e,
      });
      console.log('db error' + e);
      return;
    }

    const allUsers = { ...playing_users, ...sitout_users };

    for (const v in allUsers) {
      if (
        allUsers[v] === finishGameDto.user_1st ||
        allUsers[v] === finishGameDto.user_2nd ||
        allUsers[v] === finishGameDto.user_3rd
      ) {
        continue;
      } else {
        const user = {
          user_uuid: allUsers[v],
          game_id: client.data.gameId,
          game_date: now,
          prize_type: finishGameDto.prize_type,
          prize_amount: 0,
        };
        try {
          this.userGameRepository
            .insert(user)
            .then((r) => console.log(allUsers[v] + 'data inserted'));
        } catch (e) {
          client.emit('error', {
            type: 'finishGame',
            msg: 'insert others data error. try again and check the logs: ' + e,
          });
          return;
        }
      }
    }

    // for publish
    // this.deleteGameRoom(client);
    client.emit('getMessage', '게임 기록 성공!');
  }

  getGameRoom(gameId: string): roomListDto {
    return this.roomList[gameId];
  }

  getGameRoomList(): Record<string, roomListDto> {
    return this.roomList;
  }

  deleteGameRoom(client: Socket) {
    delete this.roomList[client.data.gameId];
    client.emit('getRoomList', this.roomList);
  }
}
