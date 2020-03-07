'use strict';

import { getCookie, makeRestRequest, Platform } from './util.js';

var i;

// Takes an http response, converts it into HTML, and runs *scan_func* every
// time a script tag is encountered.
const forEachScript = (html_response, scan_func) => {
  let fake_html = document.createElement('html');
  fake_html.innerHTML = html_response;
  let scripts = fake_html.getElementsByTagName('script');
  Array.prototype.slice.call(scripts).some(scan_func);
};

// Given a script tag, try to extract a particular dict that YouTube neatly
// stores a lot of page data in.
const findYtDict = (script_tag, sanity_str, regex_str) => {
  let script_str = script_tag.innerHTML;
  if (script_str.includes(sanity_str)) {
    console.log(sanity_str);
    let matches = script_str.match(
        new RegExp(regex_str));
    if (matches && matches.length >= 2) {
      return JSON.parse(matches[1]);
    } else {
      console.error('Can\'t regex yt dict, sanity str: ' + sanity_str);
    }
  }
};

const findWatchPageDict = script_tag => {
  return findYtDict(script_tag, 'window["ytInitialPlayerResponse"] = ',
    'window\\[\\"ytInitialPlayerResponse\\"\\] = ({.*});');
};

const findHomePageDict = script_tag => {
  return findYtDict(script_tag, 'ytInitialGuideData = ',
    'ytInitialGuideData = ({.*});');
};

const fetchYtHome = () => {
  return makeRestRequest({
    method: 'GET',
    url: 'https://www.youtube.com',
    headers: {}
  });
};

// Loads '.../channel/UC.../live' and returns {view_count:xx, title:xx}.
const fetchLiveWatchPageData = url => {
  return new Promise((resolve, reject) => {
    makeRestRequest({
      method: 'GET',
      url: url
    })
    .then(response => {
      let watch_page_data = {};
      forEachScript(response, script => {
        // Scrape stream title.
        let yt_dict = findWatchPageDict(script);
        if (yt_dict) {
          if (yt_dict.videoDetails) {
            watch_page_data.title = yt_dict.videoDetails.title;
          } else {
            console.error("Can't regex ytInitialPlayerResponse data.");
          }
          return true; // break
        }
      });

      forEachScript(response, script => {
        // Scrape live viewer count.
        let script_str = script.innerHTML;
        if (script_str.includes('watching now')) {
          let viewers_matches = script_str.match(
              new RegExp('([\\d,]+)\ watching\ now'));
          if (viewers_matches.length >= 2) {
            watch_page_data.view_count = parseInt(
                viewers_matches[1].replace(',', ''));
            resolve(watch_page_data);
            return true; // break
          } else {
            reject(`Failed to regex view count for ${url}`);
          }
        }
      });
      reject(`Failed to find 'watching now' for ${url}, stream probably wen't offline`);
    })
    .catch(reject);
  });
};

const buildStreamerObj = renderer => {
  if (renderer.badges && renderer.badges.liveBroadcasting) {
    return {
      avatar: renderer.thumbnail.thumbnails[0].url,
      name: renderer.title,
      game: 'None', // No easy API for this.
      view_count: 0, // No easy API for this, filled later.
      link: 'https://www.youtube.com/channel/' +
        renderer.navigationEndpoint.browseEndpoint.browseId + '/live',
      platform: Platform.YOUTUBE
    };
  }
};

const isYtcfgValid = ytcfg => {
  return ytcfg.XSRF_TOKEN != null &&
    ytcfg.INNERTUBE_CONTEXT_CLIENT_VERSION != null;
};

class YoutubeFetcher {
  constructor() {
    // Whether the last fetch was successful.
    this.status = false;

    // Used to expire a successful status.
    this.last_success = -1;

    // The last retrieved streamer objects fetched. If there was a failure,
    // return [].
    this.streamer_objs = [];
  }

  fetchStreamerObjs() {
    return new Promise((resolve, reject) => {
      fetchYtHome()
        .then(response => {
          let new_streamer_objs = [];
          let found_subs = false;
          forEachScript(response, script => {
            let yt_dict = findHomePageDict(script);
            if (yt_dict) {
              yt_dict.items.some(item => {
                let is_logged_in_but_no_subs_marker = item.guideSectionRenderer;
                if (is_logged_in_but_no_subs_marker &&
                    is_logged_in_but_no_subs_marker.title == 'Subscriptions') {
                  found_subs = true;
                }

                let subs = item.guideSubscriptionsSectionRenderer;
                if (subs) {
                  subs.items.forEach(item => {
                    let guideEntry = item.guideEntryRenderer;
                    if (guideEntry) {
                      found_subs = true;
                      let streamer_obj = buildStreamerObj(guideEntry);
                      if (streamer_obj) {
                        new_streamer_objs.push(streamer_obj);
                      }
                    }

                    // Followed channels under 'Show More'.
                    let hidden_subs = item.guideCollapsibleEntryRenderer;
                    if (hidden_subs) {
                      hidden_subs.expandableItems.forEach(item => {
                        let guideEntry = item.guideEntryRenderer;
                        if (guideEntry) {
                          let streamer_obj = buildStreamerObj(guideEntry);
                          if (streamer_obj) {
                            new_streamer_objs.push(streamer_obj);
                          }
                        }
                      });
                    }
                  });
                  return true; // break
                }
              });
            }
            if (found_subs) {
              return true; // break;
            }
          });
          if (found_subs) {
            this.status = true;
            this.last_success = Date.now();
          } else {
            this.status = false;
          }
          this.streamer_objs = new_streamer_objs;
          return this.streamer_objs;
        }).then(new_streamer_objs => {
          let watch_page_promises = [];
          new_streamer_objs.forEach(streamer_obj => {
            watch_page_promises.push(
              fetchLiveWatchPageData(streamer_obj.link));
          });
          return Promise.all(watch_page_promises);
        }).then(watch_page_data => {
          for (i = 0; i < watch_page_data.length; i++) {
            this.streamer_objs[i].view_count = 
                watch_page_data[i].view_count;
            this.streamer_objs[i].stream_title =
                watch_page_data[i].title;
          }
          resolve(this.streamer_objs);
        })
        .catch(error => {
          console.log('Unable to reach YouTube: ', error);
          this.status = false;
          this.streamer_objs = [];
          resolve(this.streamer_objs);
        });
    });
  }
}

export {YoutubeFetcher};
