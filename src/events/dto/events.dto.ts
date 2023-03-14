export class roomListDto {
  table_no: number;
  game_id: string;
  dealer_id: string;
  game_name: string;
  entry_limit: number;
  entry: number;
  ticket_amount: number;
  ticket_type: string;
  blind: string;
  ante: number;
  playing_users: string[];
  sitout_users: string[];
  status: string;
}

export class createRoomRequestDto {
  table_no: number;
  game_name: string;
  entry_limit: number;
  ticket_amount: number;
  ticket_type: string;
  blind: string;
  ante: number;
  status: string;
}

export class finishGameDto {
  user_1st: string;
  user_2nd: string;
  user_3rd: string;
  prize_type: string;
  prize_amount: number;
}
