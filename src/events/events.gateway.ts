import { Server, Socket } from 'socket.io';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { RoomService } from './events.service';
import { createRoomRequestDto, finishGameDto } from './dto/events.dto';
import * as jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
dotenv.config();

@WebSocketGateway(5000)
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly roomService: RoomService) {}
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket): void {
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

    if (!client.data.roles.includes('ROLE_PERMITTED')) {
      client.emit('error', '가입 승인 되지 않은 유저');
      client.disconnect();
      return;
    }

    client.leave(client.id);
    client.data.gameId = `room:lobby`;
    client.join('room:lobby');
  }

  handleDisconnect(client: Socket): void {
    const { gameId } = client.data;

    if (!this.server.sockets.adapter.rooms.get(gameId)) {
      this.server.emit('getGameRoomList', this.roomService.getGameRoomList);
    }
  }

  // TODO 타이머
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
  enterGameRoom(client: Socket, gameId: string) {
    console.log(client.data.nickname + ' trying to enter ' + gameId);

    if (!this.roomService.getGameRoom(gameId)) {
      client.emit('error', { type: 'enterGameRoom', msg: '방 아이디 확인' });
      return;
    }

    if (client.rooms.has(gameId)) {
      return;
    }

    this.roomService.enterGameRoom(client, gameId);

    return {
      gameId: gameId,
      gameName: this.roomService.getGameRoom(gameId).game_name,
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

  // TODO 타이머, 승점 가산점
  // TODO 자리 만들기
}
