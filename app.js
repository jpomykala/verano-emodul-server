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
  console.log("Signing in");
  const loginResponse = await axios.post('https://emodul.pl/login', requestBody);
  console.log("Login Success");
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

const pushThermostatState = async (sessionCookie, targetState = 1) => {
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

//https://github.com/PJCzx/homebridge-thermostat
/**
 * {
    "targetHeatingCoolingState": INT_VALUE_0_TO_3,
    "targetTemperature": FLOAT_VALUE,
    "currentHeatingCoolingState": INT_VALUE_0_TO_2,
    "currentTemperature": FLOAT_VALUE
}
 **/

let SESSION_COOKIE_TMP = "";
let TARGET_TEMPERATURE_TMP = 18;

app.get('/status', async (req, res) => {

  if(SESSION_COOKIE_TMP === ""){
    SESSION_COOKIE_TMP = await loginUser();
  }
  let tiles;
  try {
     tiles = await getTiles(SESSION_COOKIE_TMP);
  } catch (e){
    console.log("Could not fetch tiles", e);
    SESSION_COOKIE_TMP = await loginUser();
    tiles = await getTiles(SESSION_COOKIE_TMP);
  }

  const currentTemperature = await extractCurrentTemperature(tiles);
  const targetTemperature = await extractDesiredTemperature(tiles);
  TARGET_TEMPERATURE_TMP = targetTemperature;

  const HEATING_STATE = 1;

  res.send({
    targetHeatingCoolingState: HEATING_STATE,
    targetTemperature,
    currentHeatingCoolingState: HEATING_STATE,
    currentTemperature
  })
});

app.get('/targetTemperature/:targetTemperature', async (req, res) => {
  const targetTemperature = req.params.targetTemperature
  try {
    const response = await pushTemperatureUpdate(SESSION_COOKIE_TMP, targetTemperature);
    console.log(`Update target temperature to: ${targetTemperature}, success: ${response}`);
    TARGET_TEMPERATURE_TMP = targetTemperature;
    res.sendStatus(200);
  } catch (e) {
    console.error("Error during temperature update", e);
    res.sendStatus(400)
  }
});

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
  const targetstate = Number(req.query.targetstate)

  if (targetstate === 0 || targetstate === 3) {
    console.log(`Invalid state value: ${targetstate}`)
    res.sendStatus(400)
    return
  }

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

const updateHomebridgeValue = async (accessoryId, customParams) => {
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

  const accessoryId = 'verano-temp';
  await updateHomebridgeValue(accessoryId, {currenttemperature})
  console.log("currenttemperature:", currenttemperature);
  await updateHomebridgeValue(accessoryId, {targettemperature})
  console.log("targettemperature:", targettemperature);
  await updateHomebridgeValue(accessoryId, {currentstate})
  console.log("currentstate:", currentstate);
  // await updateHomebridgeValue('verano-temp', {targetstate})
  // console.log("targetstate:", targetstate);
}

// cron.sc/hedule("*/15 * * * *", async () => {
//   await updateValues()
// });


app.listen(3080, async () => {
  // await updateValues()
  console.log('listening on 3080')
})
