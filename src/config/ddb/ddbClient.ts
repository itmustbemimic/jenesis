import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { fromEnv } from '@aws-sdk/credential-providers';

export const ddbClient = new DynamoDBClient({
  region: 'ap-northeast-2',
  credentials: fromEnv(),
});
