import React from 'react';

export default class AppPanel extends React.Component {
  render() {
    return <h1>Hello, {this.props.name}</h1>;
  }
}
