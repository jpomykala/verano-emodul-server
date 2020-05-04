const express = require('express');
const axios = require('axios')
const cron = require("node-cron")
const fs = require('fs');
const app = express();

app.use(express.json())

const loginUser = async () => {
  const credentials = JSON.parse(fs.readFileSync('credentials.json'));
  const requestBody = {
    username: credentials.username,
    password: credentials.password,
    rememberMe: true,
    languageId: 'en'
  };
  const loginResponse = await axios.post('https://emodul.pl/login', requestBody);
  const cookies = loginResponse.headers['set-cookie'];
  return cookies.filter(cookie => cookie.includes('session'))[0];
}

const getTiles = async (sessionCookie) => {
  return await axios.get('https://emodul.pl/update_data', {
    headers: {
      'Cookie': sessionCookie
    }
  }).then(response => response.data.tiles);
};

const getDesiredTemperature = async (sessionCookie) => {
  const tiles = await getTiles(sessionCookie);
  const temperatureTile = tiles.filter(tile => tile.id === 58)[0]
  return temperatureTile.params.widget1.value / 10
};

const getCurrentTemperature = async (sessionCookie) => {
  const tiles = await getTiles(sessionCookie);
  const temperatureTile = tiles.filter(tile => tile.id === 58)[0]
  return temperatureTile.params.widget2.value / 10;
}

const updateTemperature = async (sessionCookie, targetTemperature = 20.0) => {
  const requestBody = [
    {
      ido: 139,
      params: targetTemperature * 10,
      module_index: 0
    }
  ]
  const responseBody = await axios.post('https://emodul.pl/send_control_data', requestBody, {
    headers: {
      'Cookie': sessionCookie
    }
  }).then(response => response.data);
  return requestBody;
}


app.post('/temperatures', async (req, res) => {
  const requestedTemperature = req.body.temperature * 10
  const sessionCookie = await loginUser()
  const responseBody = await updateTemperature(sessionCookie, requestedTemperature);
  if (responseBody === 1) {
    res.send('OK')
  } else {
    res.send('NOK')
  }
});

const updateState = async (accessoryId, value) => {
  const params = {
    accessoryId,
    value
  }
  const settings = JSON.parse(fs.readFileSync('settings.json'));
  return await axios.get(`${settings.homebridgeUpdateUrl}`, {params})
    .then(response => response.data);
};

cron.schedule("*/5 * * * *", async () => {
  const sessionCookie = await loginUser();
  const currentTemperature = getCurrentTemperature(sessionCookie);
  await updateState('verano-temp', currentTemperature)
  console.log("Temperature:", currentTemperature);
});

app.listen(3000, () => {
  console.log('listening on 3000')
})
