import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';
import { UserGame } from './entity/UserGame';

dotenv.config();

const ormconfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST,
  port: 3306,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  timezone: process.env.DB_TIMEZONE,
  synchronize: false,
  entities: [UserGame],
};

export default ormconfig;
