import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FolderItem = {
  id: string;
  name: string;
};

export async function GET() {
  try {
    console.log('--- [DEBUG] folders: request received');

    if (!process.env.GOOGLE_CLIENT_ID) {
      throw new Error('MISSING ENV: GOOGLE_CLIENT_ID');
    }
    if (!process.env.GOOGLE_CLIENT_SECRET) {
      throw new Error('MISSING ENV: GOOGLE_CLIENT_SECRET');
    }
    if (!process.env.GOOGLE_REFRESH_TOKEN) {
      throw new Error('MISSING ENV: GOOGLE_REFRESH_TOKEN');
    }
    if (!process.env.GOOGLE_FOLDER_ID) {
      throw new Error('MISSING ENV: GOOGLE_FOLDER_ID');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const parentId = process.env.GOOGLE_FOLDER_ID;

    const response = await drive.files.list({
      q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name)'
    });

    const folders = (response.data.files || [])
      .map((folder) => ({
        id: folder.id,
        name: folder.name || 'Untitled'
      }))
      .filter((folder): folder is FolderItem => Boolean(folder.id));

    return NextResponse.json({ folders });
  } catch (error) {
    console.error('--- [ERROR LOG START] ---');

    const err = error as {
      message?: string;
      response?: { data?: unknown };
    };

    console.error('Message:', err?.message ?? 'Unknown error');

    if (err?.response?.data) {
      console.error('Google API Error Details:', JSON.stringify(err.response.data, null, 2));
    }

    console.error('--- [ERROR LOG END] ---');

    return NextResponse.json(
      {
        error: err?.message ?? 'Unknown error',
        details: err?.response?.data ?? null
      },
      { status: 500 }
    );
  }
}
