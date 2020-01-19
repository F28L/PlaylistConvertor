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

var OAUTH_TOKEN;

app.use(bodyParser.json());       // to support JSON-encoded bodies

app.listen(port, () => console.log(`Example app listening on port ${port}!`))

app.get('/callback', async function (req, res) {
    const { code, state } = req.query;
    let { id, name, description, public } = JSON.parse(state);

    // call the post and finish the oauth flow :)
    OAUTH_TOKEN = await completeOAuthFlow(code);

    // Get song names to convert
    let songList = await getPlaylistSpotify(id);
    // Get Spotify user name
    let username = await GetUserName();
    // Create the playlist
    let spotifyPLid = await CreatePlaylist(username, name, description, public);
    // Add the songs
    for (const song of songList) {
        // console.error(song);
        let songID = await searchWithArtistAlbumTitle(song);

        // only add it if we found a valid song
        if (songID)
            await addToPlaylist(spotifyPLid, songID);
    }
    res.send("It's done!");
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

// Apple music time

// Fetch a playlist based on the ID and storefront
const getPlaylistApple = async (playlistID) => {
    fetch(`https://api.music.apple.com/v1/catalog/us/playlists/${playlistID}`, {
        method: 'get',
        headers: {
            'Authorization': 'Bearer '
        }
    })
        .then(res => {
            //print out playlist data
            console.log(res);
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
                console.error(res);
                resolve(res.items.map(i => {
                    return i.track.artists[0].name + ' ' + i.track.album.name + ' ' + i.track.name;
                }));
            })
    });
}

// Add songs to playlist
const addToPlaylist = async (playlistID, songURI) => {
    fetch(`	https://api.spotify.com/v1/playlists/${playlistID}/tracks?uris=${songURI}`, {
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

//Search for song using song title, artist name, album name
//Returns desired songs Spotify URI
const searchWithArtistAlbumTitle = async (query) => {
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
                    resolve(undefined);
                } else {
                    resolve(res.tracks.items[0].uri);
                }
            })
    });
}

// TESTING
