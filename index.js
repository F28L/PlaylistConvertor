require('dotenv').config()

const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const express = require('express');
const app = express();
const port = 3000;

// read environment variables
const CLIENT_ID = process.env['CLIENT_ID'];
const CLIENT_SECRET = process.env['CLIENT_SECRET'];
const REDIRECT_URI = process.env['REDIRECT_URI'];
const TEAM_ID = process.env['TEAM_ID'];
const KEY_ID = process.env['KEY_ID'];

var OAUTH_TOKEN;

const path = require('path');
const { getToken } = require('apple-music-token-node');

const certPath = path.resolve(__dirname, './AuthKey.p8');

const generateAppleToken = () => {
    const tokenData = getToken(certPath, TEAM_ID, KEY_ID);
    return tokenData.token;
};

app.use(bodyParser.json());       // to support JSON-encoded bodies

app.listen(port, () => console.log(`Example app listening on port ${port}!`))

app.get('/callback', async function (req, res) {
    const { code, state } = req.query;
    let { url, public } = JSON.parse(state);

    // call the post and finish the oauth flow :)
    OAUTH_TOKEN = await completeOAuthFlow(code);
    let playlistID = url.substring(url.lastIndexOf('pl.'));

    // Get song names to convert
    let songList = await getPlaylistApple(playlistID);
    
    // Get Spotify user name
    let username = await GetUserName();
    
    // Create the playlist
    let {name, description} = await getApplePlaylistProps(playlistID);
    console.error(name);
    console.error(description);
    
    let spotifyPLid = await CreatePlaylist(username, name, description ? description.standard : "", public);
    
    // Add the songs
    var index = 0; var total = 0;
    var songsToAdd = '';
    for (const song of songList) {
        index++;
        total++;
        let songID = await searchWithISRC(song);
        if(songID){
            songsToAdd += songID + ',';
        }
        // only add it if we found a valid song + a batch of 20 is fullfilled or reached end of list
        if (index == 20 || total >= songList.length){
            index = 0;
            songsToAdd = songsToAdd.substring(0,songsToAdd.lastIndexOf(','));
            //console.log(songsToAdd);
            await addToPlaylist(spotifyPLid, songsToAdd);
            songsToAdd = '';
        }    
    }
    res.send("It's done! Go check your Spotify Library and enjoy!");
})

// Successfully get the user's id (not display name)
const GetUserName = async () => {
    return new Promise((resolve) => {
        fetch('https://api.spotify.com/v1/me', {
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OAUTH_TOKEN}`
            }
        })
            .then(res => res.json())
            .then(res => {
                resolve(res.id);
            });
    });
};

//OAuth Flow
const completeOAuthFlow = async (code) => {
    return new Promise((resolve) => {
        fetch(`https://accounts.spotify.com/api/token`, {
            method: 'post',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString('base64')
            },
            body: new URLSearchParams({
                code,
                'redirect_uri': REDIRECT_URI,
                'grant_type': 'authorization_code'
            }).toString()
        })
            .then(res => res.json())
            .then(res => {
                resolve(res.access_token);
            });
    });
}

// Create default playlist with no songs in it and returns the playlist uri
const CreatePlaylist = async (display_id, playlistName, playlistDescription, playlistVisibility) => {
    return new Promise((resolve) => {
        fetch(`https://api.spotify.com/v1/users/${display_id}/playlists`, {
            method: 'post',
            body: JSON.stringify({ "name": playlistName, "description": playlistDescription, "public": playlistVisibility }),
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OAUTH_TOKEN}`
            }
        })
            .then(res => res.json())
            .then(res => {
                console.log(res.uri)
                console.log(res.uri.substring(17))
                resolve(res.uri.substring(17))
            });
    });
};

// Fetch a playlist based on the ID and storefront
const getPlaylistApple = async (playlistID) => {
    return new Promise((resolve) => {
        fetch(`https://api.music.apple.com/v1/catalog/us/playlists/${playlistID}/tracks?limit=300`, {
            method: 'get',
            headers: {
                'Authorization': 'Bearer ' + generateAppleToken()
            }
        })
            .then(res => res.json())
            .then(res => {
                //console.error(res.data);
                resolve(res.data);
            });
    })
};

const getPlaylistSpotify = async (playlist_id) => {
    return new Promise((resolve) => {
        fetch(`https://api.spotify.com/v1/playlists/${playlist_id}/tracks`, {
            method: 'get',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OAUTH_TOKEN}`
            }
        })
            .then(res => res.json())
            .then(res => {
                resolve(res.items.map(i => {
                    return i.track.artists[0].name + ' ' + i.track.album.name + ' ' + i.track.name;
                }));
            })
    });
}

// Add songs to playlist
const addToPlaylist = async (playlistID, songURI) => {
    fetch(`https://api.spotify.com/v1/playlists/${playlistID}/tracks?uris=${songURI}`, {
        method: 'post',
        headers: {
            'Authorization': `Bearer ${OAUTH_TOKEN}`,
        }
    })
        .then(res => res.json())
        .then(res => {
            console.log(res);
        })
}

//Search for song using ISRC unique to every recorded song
//Returns desired songs Spotify URI
const searchWithISRC = async (song) => {
    return new Promise((resolve) => {
        fetch(`https://api.spotify.com/v1/search?q=isrc:${song.attributes.isrc}&type=track&market=US`, {
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OAUTH_TOKEN}`,
            }
        })
            .then(res => res.json())
            .then(res => {
                if (res.tracks.items.length == 0) {
                    //let query = song.attributes.artistName + ' ' + song.attributes.name;
                    searchWithNameTrack(song)
                        .then(searchRes => resolve(searchRes));
                } else {
                    resolve(res.tracks.items[0].uri);
                }
            })
    });
}

// Searches for songs using the song's artist and song's title
const searchWithNameTrack = async (song) => {
    let query = song.attributes.artistName + ' ' + song.attributes.name;

    // Removes featured artists from the song title to improve search results
    if (query.indexOf('(feat.') != -1) {
        query = query.substring(0, query.indexOf('(feat.'));
    } else if (query.indexOf('(ft.') != -1) {
        query = query.substring(0, query.indexOf('(ft.'));
    }

    return new Promise((resolve) => {
        fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&market=US`, {
            method: 'get',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OAUTH_TOKEN}`,
            }
        })
            .then(res => res.json())
            .then(res => {
                if (res.tracks.items.length == 0) {
                    //let query = song.attributes.artistName + ' ' + song.attributes.name;
                    resolve(undefined);
                    // searchWithNameTrack(song)
                    //     .then(searchRes => resolve(searchRes));
                }else{
                    //console.error(res.tracks.items);
                    resolve(res.tracks.items[0].uri);
                }
            })
    })
}

const getApplePlaylistProps = async (playlistID) => {
    return new Promise((resolve) => {
        fetch(`https://api.music.apple.com/v1/catalog/us/playlists/${playlistID}`,{
            method: 'get',
            headers: {
                'Authorization': 'Bearer ' + generateAppleToken()
            }
        })
        .then(res => res.json())
        .then(res => resolve(res.data[0].attributes));
    });
}
