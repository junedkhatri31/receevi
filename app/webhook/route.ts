import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { verifyWebhook } from '../../lib/verify';
import { WebHookRequest } from '../../types/webhook';
import { createServiceClient } from '../../lib/supabase/service-client';
import { DBTables } from '../../enums/Tables';

export const revalidate = 0

export async function GET(request: Request) {
  const urlDecoded = new URL(request.url)
  const urlParams = urlDecoded.searchParams
  let mode = urlParams.get('hub.mode');
  let token = urlParams.get('hub.verify_token');
  let challenge = urlParams.get('hub.challenge');
  if (mode && token && challenge && mode == 'subscribe') {
    const isValid = token == process.env.WEBHOOK_VERIFY_TOKEN
    if (isValid) {
      return new NextResponse(challenge)
    } else {
      return new NextResponse(null, { status: 403 })
    }
  } else {
    return new NextResponse(null, { status: 400 })
  }
}

export async function POST(request: NextRequest) {
  const headersList = headers();
  const xHubSigrature256 = headersList.get('x-hub-signature-256');
  const rawRequestBody = await request.text()
  console.log('rawRequestBody', rawRequestBody)
  if (!xHubSigrature256 || !verifyWebhook(rawRequestBody, xHubSigrature256)) {
    return new NextResponse(null, { status: 401 })
  }
  const webhookBody = JSON.parse(rawRequestBody) as WebHookRequest;
  if (webhookBody.entry.length > 0) {
    const supabase = createServiceClient()
    let { error } = await supabase
      .from(DBTables.Webhook)
      .insert(webhookBody.entry.map((entry) => {
        return { payload: entry }
      }))
    if (error) throw error
    const changes = webhookBody.entry[0].changes;
    if (changes.length > 0) {
      if (changes[0].field === "messages") {
        const changeValue = changes[0].value;
        const contacts = changeValue.contacts;
        const messages = changeValue.messages;
        if (contacts && contacts.length > 0) {
          for (const contact of contacts) {
            let { error } = await supabase
              .from(DBTables.Contacts)
              .upsert({
                wa_id: contact.wa_id,
                profile_name: contact.profile.name,
              })
            if (error) throw error
          }
        }
        if (messages) {
          let { error } = await supabase
            .from(DBTables.Messages)
            .insert(messages.map(message => {
              return {
                from: message.from,
                message: message
              }
            }))
          if (error) throw error
        }
      }
    }
  }
  return new NextResponse()
}