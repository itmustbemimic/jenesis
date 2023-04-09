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
import axios from 'axios';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

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
        client.emit('createGameRoomError', '테이블이 이미 사용중입니다.');
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
      status: 'waiting',
      seat: new Array(11),
    };

    this.timer[gameId] = {
      timer: null,
      time: null,
      level: 0,
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
    const { time } = this.timer[gameId];
    const min = Math.floor(time / 60);
    const sec = time % 60;

    client.emit('timer', min + ':' + sec.toString().padStart(2, '0'));

    // enterGame은 방에 입장만. 실제 게임 참여는 seat
    client.data.gameId = gameId;
    client.rooms.clear();
    console.log(client.rooms);
    client.join(gameId);
  }

  seat(client: Socket, requestDto: enterGameDto) {
    const { gameId, chair, isGuest } = requestDto;
    const { nickname, uuid } = client.data;
    const {
      playing_users,
      dealer_id,
      entry,
      entry_limit,
      seat,
      ticket_type,
      ticket_amount,
      game_name,
    } = this.getGameRoom(gameId);

    // 엔트리 꽉차면 입장 불가. 해당게임 딜러는 꽉차도 들어와야지
    if (entry_limit <= entry && dealer_id !== nickname) {
      client.emit('seatError', '엔트리 꽉참');
      return;
    }

    if (seat[requestDto.chair] != null) {
      client.emit('seatError', '이미 사용중인 자리입니다.');
      return;
    }

    if (isGuest) {
      //게스트
      axios
        .put(
          'http://43.201.103.250:8080/member/joingame',
          {
            type: ticket_type,
            usage: game_name + ' for guest',
            amount: ticket_amount,
          },
          {
            headers: {
              Authorization: client.handshake.headers.authorization,
            },
          },
        )
        .then((r) => {
          this.getGameRoom(gameId).entry++;
          this.getGameRoom(gameId).seat[chair] = {
            nickname: 'Guest',
            uuid: 'Guest',
          };
          client.to(gameId).emit('getMessage', 'Guest 게임 참가');
          client.emit('getGameRoomList', this.roomList);
        })
        .catch((err) => client.emit('seatError', err.response.data));
    } else {
      // 게스트 아님
      // 앉으려는 자리가 사용중이라면 입장 불가.
      // 내가 앉아있던 자리면 사용 가능.

      // 이미 플레이중인 유저가 들어오면 엔트리 추가안함. 티켓 소모도 안함
      // 해당 게임의 딜러는 입장해도 엔트리/게임자리 차지 안함
      if (!playing_users[nickname] && dealer_id !== client.data.nickname) {
        axios
          .put(
            'http://43.201.103.250:8080/member/joingame',
            {
              type: ticket_type,
              usage: game_name,
              amount: ticket_amount,
            },
            {
              headers: {
                Authorization: client.handshake.headers.authorization,
              },
            },
          )
          .then((r) => {
            playing_users[nickname] = uuid;
            this.getGameRoom(gameId).entry++;
            this.getGameRoom(gameId).seat[chair] = {
              nickname: nickname,
              uuid: uuid,
            };
            client.to(gameId).emit('getMessage', nickname + ' 게임 참가');
            client.emit('getGameRoomList', this.roomList);
          })
          .catch((err) => client.emit('seatError', err.response.data));
      }

      // 티켓이 부족하면 enterGame이랑 똑같음
      client.data.gameId = gameId;
      client.rooms.clear();
      client.join(gameId);
    }
  }

  sitoutGame(client: Socket, gameId: string, chair: number) {
    const { playing_users, sitout_users, seat } = this.getGameRoom(gameId);
    const userNickname = seat[chair].nickname;

    // 게스트 아니면서 플레이 중인 유저.
    // 게스트는 플레이 기록이 필요 없음 => 게스트가 아닌 유저만 싯아웃/플레잉 유저 칸에 기록
    if (playing_users[userNickname]) {
      sitout_users[userNickname] = playing_users[userNickname];
      delete playing_users[userNickname];
    }

    seat[chair] = null;

    client.to(gameId).emit('getMessage', userNickname + 'sitout');
    client.emit('getGameRoomList', this.getGameRoomList());
  }

  finishGame(client: Socket, finishGameDto: finishGameDto) {
    const { playing_users, sitout_users } = this.getGameRoom(
      client.data.gameId,
    );

    // 해당 게임의 딜러만 게임 종료 가능
    if (
      this.getGameRoom(client.data.gameId).dealer_id !== client.data.nickname
    ) {
      client.emit(
        'finishGameError',
        '게임에 속해 있지 않거나, 해당 게임의 딜러가 아닙니다.',
      );
      return;
    }

    const now: string = new Date().toISOString();

    // game data
    const game = {
      TableName: process.env.GAME_TABLE_NAME,
      Item: {
        game_id: client.data.gameId,
        game_date: now,
        user_1st: finishGameDto.user_1st ?? null,
        user_2nd: finishGameDto.user_2nd ?? null,
        user_3rd: finishGameDto.user_3rd ?? null,
        prize_type: finishGameDto.prize_type,
        // prize_amount: finishGameDto.prize_amount,
        user_list: {
          ...playing_users,
          ...sitout_users,
        },
      },
    };

    // winners data
    if (finishGameDto.user_1st) {
      const user1 = {
        user_uuid: finishGameDto.user_1st,
        game_id: client.data.gameId,
        game_date: now,
        place: 1,
        point: 1,
        prize_type: finishGameDto.prize_type,
        prize_amount: 4,
      };
      this.insertMySql(user1);
    }

    if (finishGameDto.user_2nd) {
      const user2 = {
        user_uuid: finishGameDto.user_2nd,
        game_id: client.data.gameId,
        game_date: now,
        place: 2,
        point: 0,
        prize_type: finishGameDto.prize_type,
        prize_amount: 2,
      };
      this.insertMySql(user2);
    }

    if (finishGameDto.user_3rd) {
      const user3 = {
        user_uuid: finishGameDto.user_3rd,
        game_id: client.data.gameId,
        game_date: now,
        place: 3,
        point: 0,
        prize_type: finishGameDto.prize_type,
        prize_amount: 1,
      };
      this.insertMySql(user3);
    }

    // for test
    this.deleteGameRoom(client);

    try {
      ddbClient
        .send(new PutCommand(game))
        .then((data) => console.log('game data add success '));
    } catch (e) {
      client.emit(
        'finishGameError',
        'insert game data error. try again and check the logs: ' + e,
      );
      console.error('insert winner error ' + e);
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
          client.emit(
            'finishGameError',
            'insert others data error. try again and check the logs: ' + e,
          );
          console.error('insert rest of user error ' + e);
          return;
        }
      }
    }

    // for publish
    // this.deleteGameRoom(client);
    client.to(client.data.gameId).emit('recordSuccess', '게임 기록 성공!');
    client.broadcast.emit('getGameRoomList', this.getGameRoomList());
  }

  startTimer(client: Socket) {
    const { gameId } = client.data;
    if (!gameId) {
      client.emit('startTimerError', '만들어진 방이 없습니다.');
      return;
    }

    const { duration, dealer_id } = this.getGameRoom(gameId);

    if (dealer_id != client.data.nickname) {
      client.emit('startTimerError', '해당 게임의 딜러만 타이머 조작 가능.');
      return;
    }

    // 방 정보 플레이 중으로 변경
    this.roomList[gameId].status = 'playing';
    client.broadcast.emit('getGameRoomList', this.getGameRoomList());

    // 객체가 있다면 일시정지 or 타이머 동작중. 덮어쓰면안됨
    // 객체가 없다면 객체 생성
    if (!this.timer[gameId]) {
      this.timer[gameId] = {
        timer: null,
        time: null,
        level: 0,
      };
    }

    if (this.timer[gameId]?.timer) {
      client.emit('startTimerError', '타이머가 이미 동작중 입니다.');
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

      client
        .to(gameId)
        .emit('timer', min + ':' + sec.toString().padStart(2, '0'));
      this.timer[gameId].time = time;
      time--;

      // 타이머가 끝나면
      if (time < 0) {
        //타이머 초기화
        time = duration * 60 - 1;

        // 블라인드 레벨이 16미만이라면 초기화된 타이머 마저 돌아감
        if (this.timer[gameId].level < 16) {
          this.timer[gameId].level++;
          this.roomList[gameId].blind =
            blindStructure[this.timer[gameId].level];
          client.to(gameId).emit('blind', this.roomList[gameId].blind);
          client.broadcast.emit('getGameRoomList', this.getGameRoomList());

          // 블라인드 레벨이 끝났다면 타이머 삭제.
        } else this.resetTimer(client);
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
      client.emit('resetTimerError', '해당 게임의 딜러만 타이머 조작 가능.');
    }
  }

  pauseTimer(client: Socket) {
    if (
      this.getGameRoom(client.data.gameId).dealer_id == client.data.nickname
    ) {
      clearInterval(this.timer[client.data.gameId].timer);
      this.timer[client.data.gameId].timer = null;
      this.roomList[client.data.gameId].status = 'break';
      client.broadcast.emit('getGameRoomList', this.getGameRoomList());
    } else {
      client.emit('pauseTimerError', '해당 게임의 딜러만 타이머 조작 가능.');
    }
  }

  closeGame(client: Socket) {
    if (this.roomList[client.data.gameId].dealer_id == client.data.nickname) {
      this.roomList[client.data.gameId].status = 'closed';
      client.broadcast.emit('getGameRoomList', this.getGameRoomList());
    } else {
      client.emit('closeGameError', '딜러만 게임 마감 가능');
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

  insertMySql(item) {
    try {
      this.userGameRepository
        .insert(item)
        .then((r) => console.log(item.place + ' user data inserted'));
    } catch (e) {
      console.error(item.place + ' player game data insert error: ' + e);
    }
  }
}
