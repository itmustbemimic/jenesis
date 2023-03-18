import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'user_game_history' })
export class UserGame {
  @PrimaryColumn()
  user_uuid: string;

  @Column()
  game_id: string;

  @Column()
  game_date: string;

  @Column()
  place: number;

  @Column()
  point: number;

  @Column()
  prize_type: string;

  @Column()
  prize_amount: number;
}
