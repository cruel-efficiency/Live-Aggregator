'use strict';

import { getCookie, makeRestRequest, Platform } from './util.js';

// Fetches the active user's Mixer ID (not user-facing number).
const fetchUserId = () => {
    return new Promise((resolve, reject) => {
      makeRestRequest({
        method: 'GET',
        url: 'https://mixer.com/api/v1/users/current',
        headers: {},
        json: true
      })
      .then(response => {
        resolve(response.id);
      })
      .catch(reject);
    });
  };

const fetchFollowedChannels = user_id => {
    return makeRestRequest({
      method: 'GET',
      url:
        `https://mixer.com/api/v1/users/${user_id}/follows?limit=32&page=0&order=online:desc,viewersCurrent:desc,token:desc`,
      headers: {},
      json: true
    });
  };

const responseToStreamerObjs = response => {
    let new_streamer_objs = [];
    response.forEach(live_user => {
      if (!live_user.online) {
        return;
      }
      new_streamer_objs.push({
        avatar: live_user.user.avatarUrl,
        name: live_user.user.username,
        stream_title: live_user.name,
        game: live_user.type.name,
        view_count: live_user.viewersCurrent,
        link: 'https://www.mixer.com/' + live_user.user.username,
        platform: Platform.MIXER
      });
    });
    return new_streamer_objs;
  };

class MixerFetcher {
  constructor() {
    // Whether the last fetch was successful.
    this.status = false;

    // The last retrieved streamer objects fetched. If there was a failure,
    // return [].
    this.streamer_objs = [];
  }

  // Gets the user's ID, then fetches their live follower list.
  // Returns: Promise which resolves when all calls are complete.
  fetchStreamerObjs() {
    return new Promise((resolve, reject) => {
      fetchUserId()
        .then(fetchFollowedChannels)
        .then(response => {
          this.streamer_objs = responseToStreamerObjs(response);
          this.status = true;
          resolve(this.streamer_objs);
        })
        .catch(error => {
          console.log('Unable to reach Mixer: ', error);
          this.status = false;
          this.streamer_objs = [];
          resolve(this.streamer_objs);
        });
    });
  }
}

export {MixerFetcher};
