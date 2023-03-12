import { Server, Socket } from 'socket.io';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { RoomService } from './events.service';
import { createRequestDto } from './dto/events.dto.request.create.room';
import * as jwt from 'jsonwebtoken';
import * as dotenv from 'dotenv';
import * as timers from 'timers';
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
    } catch (e) {
      client.emit('getMessage', e);
      client.disconnect();
      return;
    }

    if (!client.data.roles.includes('ROLE_PERMITTED')) {
      client.emit('getMessage', '가입 승인 되지 않은 유저');
      client.disconnect();
      return;
    }

    client.leave(client.id);
    client.data.gameId = `room:lobby`;
    client.join('room:lobby');
  }

  handleDisconnect(client: Socket): void {
    const { gameId } = client.data;

    if (
      gameId != 'room:lobby' &&
      !this.server.sockets.adapter.rooms.get(gameId)
    ) {
      //this.roomService.deleteGameRoom(gameId);
      this.server.emit('getGameRoomList', this.roomService.getGameRoomList);
    }
    console.log('disconnected', client.id);
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
  createGameRoom(client: Socket, requestDto: createRequestDto) {
    if (!client.data.roles.includes('ROLE_ADMIN')) {
      client.emit('getMessage', '관리자만 게임 생성 가능');
      return;
    }

    if (
      client.data.gameId != 'room: lobby' &&
      this.server.sockets.adapter.rooms.get(client.data.gameId).size == 1
    ) {
      this.roomService.deleteGameRoom(client.data.gameId);
    }

    this.roomService.createGameRoom(client, requestDto);
    client.emit('getGameRoomList', this.roomService.getGameRoomList());

    return {
      gameId: client.data.gameId,
      gameName: this.roomService.getGameRoom(client.data.gameId).game_name,
    };
  }

  @SubscribeMessage('enterGameRoom')
  enterGameRoom(client: Socket, gameId: string) {
    console.log(client.data.nickname + ' trying to enter ' + gameId);

    if (client.rooms.has(gameId)) {
      return;
    }

    if (
      client.data.gameId != 'room:lobby' &&
      this.server.sockets.adapter.rooms.get(client.data.gameId).size == 1
    ) {
      this.roomService.deleteGameRoom(client.data.gameId);
    }

    this.roomService.enterGameRoom(client, gameId);

    return {
      gameId: gameId,
      gameName: this.roomService.getGameRoom(gameId).game_name,
    };
  }

  @SubscribeMessage('sitout')
  sitoutGame(client: Socket, userNickname: string) {
    const { gameId } = client.data;

    return this.roomService.sitoutGame(client, gameId, userNickname);
  }

  // TODO 어드민 게임종료 버튼 만들기

  // TODO 타이머, 등수 설정 게임 종료, 싯아웃 로직 수정
}
