import { Server, Socket } from 'socket.io';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { RoomService } from './events.service';
import {
  createRoomRequestDto,
  enterGameDto,
  finishGameDto,
} from './dto/events.dto';
import * as jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
dotenv.config();

@WebSocketGateway(5000)
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly roomService: RoomService) {}
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket): void {
    // jwt decode
    try {
      const decodedJwt = jwt.verify(
        client.handshake.headers.authorization.substring('Bearer '.length),
        process.env.JWT_SECRET,
      );
      client.data.nickname = decodedJwt.nickname;
      client.data.roles = decodedJwt.roles;
      client.data.uuid = decodedJwt.uuid;
    } catch (e) {
      client.emit('error', e);
      client.disconnect();
      return;
    }

    // jwt에 권한 없으면 연결 안받아줌
    if (!client.data.roles.includes('ROLE_PERMITTED')) {
      client.emit('error', '가입 승인 되지 않은 유저');
      client.disconnect();
      return;
    }

    client.leave(client.id);
  }

  handleDisconnect(client: Socket): void {
    const { gameId } = client.data;

    if (!this.server.sockets.adapter.rooms.get(gameId)) {
      this.server.emit('getGameRoomList', this.roomService.getGameRoomList);
    }
  }

  @SubscribeMessage('sendMessage')
  sendMessage(client: Socket, message: string): void {
    const { gameId } = client.data;
    client.to(gameId).emit('getMessage', {
      id: client.id,
      nickname: client.data.nickname,
      message,
    });
  }

  @SubscribeMessage('getGameRoomList')
  getGameRoomList(client: Socket, payload: any) {
    client.emit('getGameRoomList', this.roomService.getGameRoomList());
  }

  @SubscribeMessage('createGameRoom')
  createGameRoom(client: Socket, requestDto: createRoomRequestDto) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', {
        type: 'createGameRoom',
        msg: '관리자만 게임 생성 가능',
      });
      return;
    }

    this.roomService.createGameRoom(client, requestDto);
    client.broadcast.emit(
      'getGameRoomList',
      this.roomService.getGameRoomList(),
    );

    return {
      gameId: client.data.gameId,
      gameName: this.roomService.getGameRoom(client.data.gameId).game_name,
    };
  }

  @SubscribeMessage('enterGameRoom')
  enterGameRoom(client: Socket, enterGameDto: enterGameDto) {
    console.log(
      client.data.nickname + ' trying to enter ' + enterGameDto.gameId,
    );

    // 입력받은 게임방이 존재하지 않음
    if (!this.roomService.getGameRoom(enterGameDto.gameId)) {
      client.emit('error', { type: 'enterGameRoom', msg: '방 아이디 확인' });
      return;
    }

    // 이미 해당 게임방에 속해 있으면 아무것도 안함
    if (client.rooms.has(enterGameDto.gameId)) {
      return;
    }

    // 게임 입장
    this.roomService.enterGameRoom(client, enterGameDto);

    return {
      gameId: enterGameDto,
      gameName: this.roomService.getGameRoom(enterGameDto.gameId).game_name,
    };
  }

  @SubscribeMessage('seat')
  seat(client: Socket, enterGameDto: enterGameDto) {
    // 입력받은 게임방이 존재하지 않음
    if (!this.roomService.getGameRoom(enterGameDto.gameId)) {
      client.emit('error', { type: 'enterGameRoom', msg: '방 아이디 확인' });
      return;
    }

    // 게임 입장
    this.roomService.seat(client, enterGameDto);

    return {
      gameId: enterGameDto,
      gameName: this.roomService.getGameRoom(enterGameDto.gameId).game_name,
    };
  }

  @SubscribeMessage('sitout')
  sitoutGame(client: Socket, userNickname: string) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', { type: 'sitout', msg: '관리자만 싯아웃 가능' });
      return;
    }

    const { gameId } = client.data;

    return this.roomService.sitoutGame(client, gameId, userNickname);
  }

  // TODO 마감된 게임 만들기

  @SubscribeMessage('finishGame')
  finishGame(client: Socket, finishGameDto: finishGameDto) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', {
        type: 'finishGame',
        msg: '관리자만 게임 종료 가능',
      });
      return;
    }
    return this.roomService.finishGame(client, finishGameDto);
  }

  @SubscribeMessage('startTimer')
  startTimer(client: Socket) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', {
        type: 'startTimer',
        msg: '관리자만 타이머 시작 가능',
      });
    }
    this.roomService.startTimer(client);
  }

  @SubscribeMessage('resetTimer')
  resetTimer(client: Socket) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', {
        type: 'startTimer',
        msg: '관리자만 타이머 리셋 가능',
      });
      return;
    }
    this.roomService.resetTimer(client);
  }

  @SubscribeMessage('closeGame')
  closeGame(client: Socket) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', {
        type: 'finishGame',
        msg: '관리자만 게임 마감 가능',
      });
      return;
    }
    this.roomService.closeGame(client);
  }

  @SubscribeMessage('pauseTimer')
  stopTimer(client: Socket) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('error', {
        type: 'startTimer',
        msg: '관리자만 타이머 정지 가능',
      });
      return;
    }
    this.roomService.pauseTimer(client);
  }

  // TODO 승점 가산점
}
