import { Injectable } from '@nestjs/common';
import {
  enterGameDto,
  finishGameDto,
  roomListDto,
  Timer,
} from './dto/events.dto';
import { createRoomRequestDto } from './dto/events.dto';
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { ddbClient } from '../config/ddb/ddbClient';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { InjectRepository } from '@nestjs/typeorm';
import { UserGame } from '../entity/UserGame';
import { Repository } from 'typeorm';
import { blindStructure } from '../constants/blind';

@Injectable()
export class RoomService {
  private readonly roomList: Record<string, roomListDto>;
  private readonly timer: Record<string, Timer>;

  constructor(
    @InjectRepository(UserGame)
    private userGameRepository: Repository<UserGame>,
  ) {
    this.roomList = {};
    this.timer = {};
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
      seat: new Array(11),
    };

    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);
    client.emit('getMessage', this.roomList);

    // 방 만든 어드민한테 해당 게임 방 아이디 전송
    client.to(gameId).emit('newRoom', gameId);
  }

  enterGameRoom(client: Socket, requestDto: enterGameDto) {
    const { gameId } = requestDto;

    // enterGame은 방에 입장만. 실제 게임 참여는 seat
    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);
  }

  seat(client: Socket, requestDto: enterGameDto) {
    const { gameId, chair } = requestDto;
    const { nickname, uuid } = client.data;
    const { playing_users, dealer_id, entry, entry_limit, seat } =
      this.getGameRoom(gameId);

    // 엔트리 꽉차면 입장 불가. 해당게임 딜러는 꽉차도 들어와야지
    if (entry_limit <= entry && dealer_id !== nickname) {
      client.emit('error', { type: 'enterGameRoom', msg: '엔트리 꽉참' });
      return;
    }

    // 앉으려는 자리가 사용중이라면 입장 불가.
    // 내가 앉아있던 자리면 사용 가능.
    if (
      seat[requestDto.chair] != null &&
      seat[requestDto.chair].nickname !== nickname
    ) {
      client.emit('error', {
        type: 'enterGameRoom',
        msg: '이미 사용중인 자리입니다.',
      });
      return;
    }

    client.data.gameId = gameId;
    client.rooms.clear();
    client.join(gameId);

    // 이미 플레이중인 유저가 들어오면 엔트리 추가안함. 티켓 소모도 안함
    // 해당 게임의 딜러는 입장해도 엔트리/게임자리 차지 안함
    if (!playing_users[nickname] && dealer_id !== client.data.nickname) {
      playing_users[nickname] = uuid;
      this.getGameRoom(gameId).entry++;
      this.getGameRoom(gameId).seat[chair] = { nickname: nickname, uuid: uuid };
      client.to(gameId).emit('getMessage', nickname + ' 게임 참가');
      client.emit('getGameRoomList', this.roomList);
    }
  }

  sitoutGame(client: Socket, gameId: string, userNickname: string) {
    const { playing_users, sitout_users, seat } = this.getGameRoom(gameId);

    // 없는 유저를 sitout 할수는 없으니까
    if (!playing_users[userNickname]) {
      client.emit('error', {
        type: 'sitout',
        msg: userNickname + '님은 플레이 중인 유저가 아닙니다.',
      });
    } else {
      // 플레잉유저 목록에서 싯아웃 유저 목록으로 이동
      sitout_users[userNickname] = playing_users[userNickname];
      delete playing_users[userNickname];

      seat.forEach((v, i) => {
        if (v?.nickname === userNickname) {
          seat[i] = null;
          return;
        }
      });

      client.to(gameId).emit('getMessage', userNickname + 'sitout');
      client.emit('getGameRoomList', this.roomList);
    }
  }

  finishGame(client: Socket, finishGameDto: finishGameDto) {
    const { playing_users, sitout_users } = this.getGameRoom(
      client.data.gameId,
    );

    // 해당 게임의 딜러만 게임 종료 가능
    if (
      this.getGameRoom(client.data.gameId).dealer_id !== client.data.nickname
    ) {
      client.emit('error', {
        type: 'finishGame',
        msg: '게임에 속해 있지 않거나, 해당 게임의 딜러가 아닙니다.',
      });
      return;
    }

    const now: string = new Date().toISOString();

    // game data
    const game = {
      TableName: process.env.GAME_TABLE_NAME,
      Item: {
        game_id: client.data.gameId,
        game_date: now,
        user_1st: finishGameDto.user_1st,
        user_2nd: finishGameDto.user_2nd,
        user_3rd: finishGameDto.user_3rd,
        prize_type: finishGameDto.prize_type,
        // prize_amount: finishGameDto.prize_amount,
        user_list: {
          ...playing_users,
          ...sitout_users,
        },
      },
    };

    // winners data
    const user1 = {
      user_uuid: finishGameDto.user_1st,
      game_id: client.data.gameId,
      game_date: now,
      place: 1,
      point: 3,
      prize_type: finishGameDto.prize_type,
      prize_amount: 4,
    };
    const user2 = {
      user_uuid: finishGameDto.user_2nd,
      game_id: client.data.gameId,
      game_date: now,
      place: 2,
      point: 0,
      prize_type: finishGameDto.prize_type,
      prize_amount: 2,
    };
    const user3 = {
      user_uuid: finishGameDto.user_3rd,
      game_id: client.data.gameId,
      game_date: now,
      place: 3,
      point: 0,
      prize_type: finishGameDto.prize_type,
      prize_amount: 1,
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

    // 나머지 유저들 데이터
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
          place: 0,
          point: 0,
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

  startTimer(client: Socket) {
    const { gameId } = client.data;
    if (!gameId) {
      client.emit('error', {
        type: 'startTimer',
        msg: '만들어진 방이 없습니다.',
      });
    }

    const { duration, dealer_id } = this.getGameRoom(gameId);

    if (dealer_id != client.data.nickname) {
      client.emit('error', {
        type: 'startTimer',
        msg: '해당 게임의 딜러만 타이머 조작 가능.',
      });
      return;
    }

    if (!this.timer[gameId]) {
      this.timer[gameId] = {
        timer: null,
        time: null,
        level: 0,
      };
    }

    if (this.timer[gameId]?.timer) {
      client.emit('error', {
        type: 'startTimer',
        msg: '타이머가 이미 동작중 입니다.',
      });
      return;
    }

    let time = this.timer[gameId].time ?? duration * 60 - 1;
    let min = 0;
    let sec = 0;

    this.roomList[gameId].blind = blindStructure[this.timer[gameId].level];
    client.to(gameId).emit('blind', this.roomList[gameId].blind);

    this.timer[gameId].timer = setInterval(() => {
      min = Math.floor(time / 60);
      sec = time % 60;

      client.to(gameId).emit('timer', min + ':' + sec);
      this.timer[gameId].time = time;
      time--;

      if (time <= 0) {
        clearInterval(this.timer[gameId].timer);
        delete this.timer[gameId].timer;
        delete this.timer[gameId].time;
        this.timer[gameId].level++;
      }
    }, 1000);
  }

  resetTimer(client: Socket) {
    if (
      this.getGameRoom(client.data.gameId).dealer_id == client.data.nickname
    ) {
      clearInterval(this.timer[client.data.gameId].timer);
      delete this.timer[client.data.gameId];
    } else {
      client.emit('error', {
        type: 'startTimer',
        msg: '해당 게임의 딜러만 타이머 조작 가능.',
      });
    }
  }

  pauseTimer(client: Socket) {
    if (
      this.getGameRoom(client.data.gameId).dealer_id == client.data.nickname
    ) {
      clearInterval(this.timer[client.data.gameId].timer);
      this.timer[client.data.gameId].timer = null;
    } else {
      client.emit('error', {
        type: 'startTimer',
        msg: '해당 게임의 딜러만 타이머 조작 가능.',
      });
    }
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
