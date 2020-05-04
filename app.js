const express = require('express');
const axios = require('axios')
const fs = require('fs');
const app = express();

app.use(express.json())

const loginUser = async () => {
  const credentials = fs.readFileSync('credentials.json');
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

app.post('/temperatures', async (req, res) => {


  /**
   * {
   *   temperature: 20.5
   * }
   */

  const requestedTemperature = req.body.temperature * 10

  const sessionCookie = await loginUser();
  const requestBody = [
    {
      ido: 139,
      params: requestedTemperature,
      module_index: 0
    }
  ]
  const responseBody = await axios.post('https://emodul.pl/send_control_data', requestBody, {
    headers: {
      'Cookie': sessionCookie
    }
  }).then(response => response.data);

  if (responseBody === 1) {
    res.send('OK')
  } else {
    res.send('NOK')
  }
});

app.get('accessoryId', async (req, res) => {
  const sessionCookie = await loginUser();
  const tiles = await axios.get('https://emodul.pl/update_data', {
    headers: {
      'Cookie': sessionCookie
    }
  }).then(response => response.data.tiles);

  const temperatureTile = tiles.filter(tile => tile.id === 58)[0]
  const desiredTemperature = temperatureTile.params.widget1.value / 10
  const currentTemperature = temperatureTile.params.widget2.value / 10
  return res.send({
    "success": true,
    "state": currentTemperature
  });
})

app.listen(3000, () => {
  console.log('listening on 3000')
})
