#! /usr/bin/env -S deno run --allow-net --allow-env

import { Application, Router } from 'https://deno.land/x/oak@v12.6.1/mod.ts';

interface ChannelParams {
  agentName: string,
  producerAddress: string,
}

interface ChanCreateRes {
  consumerAddress: string, 
  producerAddress: string,
}

interface WriteBatchResDto {
  failures: MessageDeliveryFailure[],
}

interface MessageDeliveryFailure {
  channel: string,
  index: number,
  reason: string,
}

const megaphoneUrl = Deno.env.get("MEGAPHONE_URL") || 'http://localhost:3000';
const megaphoneAgentUrlTemplate = Deno.env.get("MEGAPHONE_AGENT_URL") || 'http://localhost:3000';
const port = 3040;
const app = new Application();

const rooms: Record<string, ChannelParams[]> = {};

const router = new Router();

async function createChannel(): Promise<{ consumerAddress: string, producerAddress: string }> {
  const url = `${megaphoneUrl}/create`;
  const { consumerAddress, producerAddress }: ChanCreateRes = await fetch(url, { method: 'POST' })
    .then((resp) => {
      if (!resp.ok) {
        throw new Error(`[${url}] HTTP status code: ${resp.status}`);
      }
      return resp.json();
    });

  return { consumerAddress, producerAddress };
}

router.post('/room/:room', async (ctx) => {
  const { consumerAddress, producerAddress } = ctx.request.headers.get('use-channel') || await createChannel();
  const agentName = consumerAddress.split('.')[0];

  const subscriptions = rooms[ctx.params.room];
  if (subscriptions) {
    rooms[ctx.params.room] = [...subscriptions, { producerAddress, agentName }];
  } else {
    rooms[ctx.params.room] = [{ producerAddress, agentName }];
  }

  ctx.response.body = JSON.stringify({
    channelUuid: consumerAddress,
    agentName
  });
});

router.post('/send/:room', async (ctx) => {
  const subscriptions = rooms[ctx.params.room];
  if (!subscriptions) {
    ctx.response.body = JSON.stringify({ status: 'NOT_FOUND' });
    return;
  }
  const req = await ctx.request.body({ type: 'json' }).value;
  const timestamp = new Date().toISOString();

  const unavailableChannels: string[] = [];
  const groupedSubs = subscriptions
    .reduce((acc, current) => {
      if (acc[current.agentName]) {
        acc[current.agentName] = [...acc[current.agentName], current];
      } else {
        acc[current.agentName] = [current];
      }
      return acc;
    }, {} as Record<string, ChannelParams[]>)
  const promises = Object.entries(groupedSubs)
    .map(([agentName, channels]) => fetch(`${megaphoneAgentUrlTemplate.replace('%agentName%', agentName)}/write-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelIds: channels.map(channelParams => channelParams.producerAddress),
        messages: [{
          streamId: 'new-message',
          body: {
            room: ctx.params.room,
            sender: req.sender,
            timestamp,
            message: req.message,
          }
        }]
      }),
    }).then(res => {
      if (res.status == 404) {
        console.warn(`subscription ${agentName} not found`);
        unavailableChannels.push(...channels.map(par => par.producerAddress))
      }
      return res.json()
    }).then((res: WriteBatchResDto) => {
      unavailableChannels.push(...res.failures.map(f => f.channel));
    }))
    ;

  await Promise.all(promises);
  for (const room of Object.keys(rooms)) {
    rooms[room] = rooms[room]
      .filter(c => !unavailableChannels.includes(c.producerAddress));
  }

  ctx.response.body = JSON.stringify({ status: 'ok' });
});

app.use(router.allowedMethods());
app.use(router.routes());

app.addEventListener('listen', () => {
  console.log(`Listening on: localhost:${port}`);
});

await app.listen({ port });