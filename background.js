'use strict';

import {
  getCookie, sendMessagePromise, makeRestRequest, Platform, timeout
} from './util.js';
import { TwitchFetcher } from './twitch.js';
import { MixerFetcher } from './mixer.js';
import { YoutubeFetcher } from './youtube.js';

var twitch_fetcher = new TwitchFetcher();
var mixer_fetcher = new MixerFetcher();
var youtube_fetcher = new YoutubeFetcher();
var streamer_objs = [];

var streamer_objs_promise;
var throttled_streamer_objs_promise;

function fetchStreamerObjs() {
  return new Promise(async (resolve, reject) => {
    let twitch_promise = twitch_fetcher.fetchStreamerObjs();
    let mixer_promise = mixer_fetcher.fetchStreamerObjs();
    let youtube_promise = youtube_fetcher.fetchStreamerObjs();

    await twitch_promise;
    await mixer_promise;
    await youtube_promise;

    streamer_objs = twitch_fetcher.streamer_objs
      .concat(mixer_fetcher.streamer_objs)
      .concat(youtube_fetcher.streamer_objs);
    chrome.browserAction.setBadgeText(
      {text: streamer_objs.length.toString()});

    streamer_objs = streamer_objs.sort((a, b) => {
      if (a.view_count > b.view_count) {
        return -1;
      }
      return 1;
    });

    resolve(streamer_objs);
  });
}

async function waitForLiveData(must_be_new) {
  if (must_be_new) {
    console.log('waiting for throttled live data');
    await throttled_streamer_objs_promise;
    console.log('done waiting for throttled live data');
  } else if (streamer_objs.length === 0) {
    console.log('waiting for first live data');
    await streamer_objs_promise;
    console.log('done waiting for first live data');
  }
  console.log(streamer_objs);
  return {
    streamer_objs: streamer_objs,
    twitch_info: {
      streamer_objs: twitch_fetcher.streamer_objs,
      status: twitch_fetcher.status,
      last_success: twitch_fetcher.last_success
    },
    mixer_info: {
      streamer_objs: mixer_fetcher.streamer_objs,
      status: mixer_fetcher.status,
      last_success: mixer_fetcher.last_success
    },
    youtube_info: {
      streamer_objs: youtube_fetcher.streamer_objs,
      status: youtube_fetcher.status,
      last_success: youtube_fetcher.last_success
    }
  };
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.topic === 'getNewStreamerObjs') {
    waitForLiveData(true).then(sendResponse);
  } else if (msg.topic === 'getStreamerObjs') {
    waitForLiveData(false).then(sendResponse);
  } else if (msg.topic === 'updateSidebarInjectionFlag') {
    chrome.tabs.query({}, function(tabs) {
      for (var i=0; i<tabs.length; ++i) {
        chrome.tabs.sendMessage(tabs[i].id, msg);
      }
      sendResponse({status: true});
    });
  }
  return true;
});

const mainLoop = async () => {
  while (true) {
    streamer_objs_promise = fetchStreamerObjs();
    throttled_streamer_objs_promise = Promise.all([
        streamer_objs_promise,
        timeout(60000)
    ]);
    await throttled_streamer_objs_promise;
  }
};

mainLoop();
