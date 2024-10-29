function rad2deg(rad) {
  return Math.round((rad * 180) / Math.PI);
}

function ms2kt(ms) {
  return parseFloat((ms * 1.94384).toFixed(1));
}

module.exports = function stateToEntry(state, text, author = '') {
  const data = {
    datetime: state['navigation.datetime'] || new Date().toISOString(),
    text,
    author,
  };
  if (state['navigation.position']) {
    data.position = {
      latitude: state['navigation.position'].latitude,
      longitude: state['navigation.position'].longitude,
    };
  }
  if (state['navigation.gnss.type'] && data.position) {
    data.position.source = state['navigation.gnss.type'];
  }
  if (!Number.isNaN(Number(state['navigation.headingTrue']))) {
    data.heading = rad2deg(state['navigation.headingTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.courseOverGroundTrue']))) {
    data.course = rad2deg(state['navigation.courseOverGroundTrue']);
  }
  if (!Number.isNaN(Number(state['navigation.speedThroughWater']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.stw = ms2kt(state['navigation.speedThroughWater']);
  }
  if (!Number.isNaN(Number(state['navigation.speedOverGround']))) {
    if (!data.speed) {
      data.speed = {};
    }
    data.speed.sog = ms2kt(state['navigation.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['navigation.log']))) {
    data.log = parseFloat((state['navigation.log'] / 1852).toFixed(1));
  }
  if (state['navigation.courseRhumbline.nextPoint.position']
    && !Number.isNaN(Number(state['navigation.courseRhumbline.nextPoint.position'].latitude))) {
    data.waypoint = state['navigation.courseRhumbline.nextPoint.position'];
  }
  if (!Number.isNaN(Number(state['environment.outside.pressure']))) {
    data.barometer = parseFloat((state['environment.outside.pressure'] / 100).toFixed(2));
  }
  if (!Number.isNaN(Number(state['environment.wind.speedOverGround']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.speed = ms2kt(state['environment.wind.speedOverGround']);
  }
  if (!Number.isNaN(Number(state['environment.wind.directionTrue']))) {
    if (!data.wind) {
      data.wind = {};
    }
    data.wind.direction = rad2deg(state['environment.wind.directionTrue']);
  }
  if (!Number.isNaN(Number(state['environment.water.swell.state']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.seaState = state['environment.water.swell.state'];
  }
  if (!Number.isNaN(Number(state['environment.outside.cloudCoverage']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.cloudCoverage = state['environment.outside.cloudCoverage'];
  }
  if (!Number.isNaN(Number(state['environment.outside.visibility']))) {
    if (!data.observations) {
      data.observations = {};
    }
    data.observations.visibility = state['environment.outside.visibility'];
  }
  Object.keys(state).forEach((key) => {
    if (!key.match(/propulsion\.[A-Za-z0-9]+\.runTime/)) {
      return;
    }
    if (!Number.isNaN(Number(state[key]))) {
      if (!data.engine) {
        data.engine = {};
      }
      data.engine.hours = parseFloat((state[key] / 60 / 60).toFixed(1));
    }
  });
  if (state['communication.vhf.channel']) {
    data.vhf = state['communication.vhf.channel'];
  }
  if (state['communication.crewNames']) {
    data.crewNames = state['communication.crewNames'];
  }
  return data;
};
