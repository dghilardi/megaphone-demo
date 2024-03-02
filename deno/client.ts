#! /usr/bin/env -S deno run --allow-net

import { MegaphonePoller } from 'npm:megaphone-client@0.10.2';
import { firstValueFrom } from "npm:rxjs@7.8.1";

const poller = new MegaphonePoller('http://localhost:3000', 100);
const o = await poller.newUnboundedStream<{ message: string, sender: string }>(async channel => {
    let res = await fetch("http://localhost:3040/room/test", {
        method: "POST",
        headers: {
            ...(channel ? { 'use-channel': channel } : {}),
        },
    }).then(res => res.json());

    return {
        channelAddress: { consumer: res.channelUuid, producer: '' },
        streamIds: ['new-message'],
    }
});

const chunk = await firstValueFrom(o);
console.log(chunk.body.message);