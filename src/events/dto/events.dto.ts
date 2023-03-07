import { Socket } from 'socket.io';
export class roomListDto {
  table_no: number;
  game_id: string;
  dealer_id: string;
  game_name: string;
  entry: number;
  ticket_amount: number;
  ticket_type: string;
  blind: string;
  ante: number;
  playing_users: string[];
  sitout_users: string[];
  status: string;
}

export class setInitDto {
  nickname: string;
  room: {
    gameId: string;
    gameName: string;
  };
}
