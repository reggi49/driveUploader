import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

const parseCredentials = (): ServiceAccountCredentials => {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) {
    throw new Error('GOOGLE_CREDENTIALS is not set');
  }

  const credentials = JSON.parse(raw) as ServiceAccountCredentials;
  if (typeof credentials.private_key === 'string') {
    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
  }

  return credentials;
};

export const getDriveClient = () => {
  const credentials = parseCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES
  });

  return google.drive({
    version: 'v3',
    auth
  });
};
