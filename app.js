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

const extractDesiredTemperature = async (tiles) => {
  const foundTile = tiles.filter(tile => tile.id === 58)[0]
  return foundTile.params.widget1.value / 10
};

const extractCurrentTemperature = async (tiles) => {
  const foundTile = tiles.filter(tile => tile.id === 58)[0]
  return foundTile.params.widget2.value / 10;
}

const extractMode = async (tiles) => {
  const foundTile = tiles.filter(tile => tile.id === 61)[0]
  return foundTile.params.statusId === 1 ? 'COOLING' : 'HEATING'; //1 - cooling, 0 - heating
}

const pushTemperatureUpdate = async (sessionCookie, targetTemperature = 20.0) => {
  const requestBody = [
    {
      ido: 139,
      params: targetTemperature * 10,
      module_index: 0
    }
  ]
  return await axios.post('https://emodul.pl/send_control_data', requestBody, {
    headers: {
      'Cookie': sessionCookie
    }
  }).then(response => response.data);
}

const pushThermostatState = async (sessionCookie, targetState) => {
  //verano 1 - heating, 0 - cooling
  const requestBody = [
    {
      ido: 138,
      params: targetState === 'COOLING' ? 0 : 1,
      module_index: 0
    }
  ]
  return await axios.post('https://emodul.pl/send_control_data', requestBody, {
    headers: {
      'Cookie': sessionCookie
    }
  }).then(response => response.data);
}

app.get('/target-temperature', async (req, res) => {
  const targettemperature = req.query.targettemperature
  const sessionCookie = await loginUser()
  try {
    const response = await pushTemperatureUpdate(sessionCookie, targettemperature);
    console.log(`Update target temperature to: ${targettemperature}, success: ${response}`);
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(400)
  }
});

app.get('/target-state', async (req, res) => {
  const targetstate = req.query.targetstate
  const sessionCookie = await loginUser()
  try {
    // homebridge 1 - heating, 2 - cooling
    const homebridgeState = targetstate === 2 ? 'COOLING' : 'HEATING'
    const response = await pushThermostatState(sessionCookie, homebridgeState);
    console.log(`Update state to: ${homebridgeState} (${targetstate}), success: ${response}`);
    res.sendStatus(200);
  } catch (e) {
    res.sendStatus(400)
  }
});

const updateState = async (accessoryId, customParams) => {
  const params = {
    accessoryId,
    ...customParams
  }
  const settings = JSON.parse(fs.readFileSync('settings.json'));
  return await axios.get(`${settings.homebridgeUpdateUrl}`, {params})
    .then(response => response.data);
};

const updateValues = async () => {
  const sessionCookie = await loginUser();
  const tiles = await getTiles(sessionCookie);
  const currenttemperature = await extractCurrentTemperature(tiles);
  const targettemperature = await extractDesiredTemperature(tiles);
  const currentStateEnum = await extractMode(tiles);

  let currentstate = 0;
  switch (currentStateEnum) {
    case "COOLING":
      currentstate = 2
      break;
    case "HEATING":
      currentstate = 1
      break
    default:
      currentstate = 0
  }

  let targetstate = currentstate;

  await updateState('verano-temp', {currenttemperature})
  await updateState('verano-temp', {targettemperature})
  await updateState('verano-temp', {currentstate})
  await updateState('verano-temp', {targetstate})
  console.log("Update");
}

cron.schedule("*/5 * * * *", async () => {
  await updateValues()
});


app.listen(3000, async () => {
  await updateValues()
  console.log('listening on 3000')
})
