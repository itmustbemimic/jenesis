import { Server, Socket } from 'socket.io';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { RoomService } from './events.service';
import { setInitDto } from './dto/events.dto';
import { createRequestDto } from './dto/events.dto.request.create.room';

@WebSocketGateway(5000)
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly roomService: RoomService) {}
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket): void {
    console.log('connected', client.id);
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
      this.roomService.deleteGameRoom(gameId);
      this.server.emit('getGameRoomList', this.roomService.getGameRoomList);
    }
    console.log('disconnected', client.id);
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

  @SubscribeMessage('setInit')
  setInit(client: Socket, data: setInitDto): setInitDto {
    if (client.data.isInit) {
      return;
    }

    client.data.nickname = data.nickname
      ? data.nickname
      : '낯선사람' + client.id;

    client.data.isInit = true;

    return {
      nickname: client.data.nickname,
      room: {
        gameId: 'room:lobby',
        gameName: 'lobby',
      },
    };
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

    return {
      gameId: client.data.gameId,
      gameName: this.roomService.getGameRoom(client.data.gameId).game_name,
    };
  }

  @SubscribeMessage('enterGameRoom')
  enterGameRoom(client: Socket, gameId: string) {
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
}
