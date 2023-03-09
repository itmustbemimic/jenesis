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
    } catch (e) {
      client.emit('getMessage', e);
      client.disconnect();
    }

    console.log('connected', client.id);
    client.leave(client.id);
    client.data.gameId = `room:lobby`;
    console.log(client.data.nickname);

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
    console.log(client.data.nickname + 'trying to make a room');
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

  @SubscribeMessage('exitGameRoom')
  exitGameRoom(client: Socket) {
    const { nickname, gameId } = client.data;

    return this.roomService.exitGameRoom(client, gameId);
  }

  // TODO 어드민 게임종료 버튼 만들기
}
