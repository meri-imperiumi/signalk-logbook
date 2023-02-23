/* eslint-env browser */
import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  CardGroup,
  Card,
  CardHeader,
  CardBody,
  CardText,
  Button,
  Form,
  FormGroup,
  Label,
  Input,
} from 'reactstrap';
import ordinal from 'ordinal';

function ms2kt(ms) {
  return parseFloat((ms * 1.94384).toFixed(1));
}

function sailText(sail) {
  let string = '';
  if (sail.area) {
    string += `${sail.area}m\u00B2 `;
  }
  if (sail.material) {
    string += `${sail.material} `;
  }
  if (string === '') {
    string += `${sail.type.charAt(0).toUpperCase()}${sail.type.slice(1)}`;
  } else {
    string += sail.type;
  }
  if (string.indexOf('sail') === -1) {
    string += ' sail';
  }
  if (sail.brand) {
    string += ` made by ${sail.brand}`;
  }
  string += '.';
  if (sail.minimumWind || sail.maximumWind) {
    string += ' For wind conditions';
    if (sail.minimumWind) {
      string += ` from ${ms2kt(sail.minimumWind)}kt`;
    }
    if (sail.maximumWind) {
      string += ` to ${ms2kt(sail.maximumWind)}kt`;
    }
    string += '.';
  }
  return string;
}

function SailEditor(props) {
  const [sails, updateSails] = useState(props.sails);
  function handleChange(id, e) {
    const { name, value } = e.target;
    const idx = sails.findIndex((s) => s.id === id);
    if (idx === -1) {
      return;
    }
    const updatedSails = [...sails];
    const updated = {
      ...updatedSails[idx],
    };
    switch (name) {
      case 'active': {
        updated[name] = e.target.checked;
        break;
      }
      case 'furledRatio': {
        if (!updated.reducedState) {
          updated.reducedState = {};
        }
        updated.reducedState.furledRatio = Number(value);
        break;
      }
      case 'reefs': {
        if (!updated.reducedState) {
          updated.reducedState = {};
        }
        updated.reducedState.reefs = parseInt(value, 10);
        break;
      }
      default: {
        updated[name] = value;
      }
    }
    updatedSails[idx] = updated;
    updateSails(updatedSails);
  }
  const renderSails = [...sails];
  const rows = [];
  const perRow = 3;
  while (renderSails.length) {
    const row = renderSails.splice(0, perRow);
    const filler = [...Array(perRow - row.length).keys()];
    rows.push(
      <CardGroup>
      {row.map((sail) => (
        <Card
          key={sail.id}
        >
          <CardHeader
            className={sail.active ? 'bg-primary' : ''}
            onClick={() => {
              handleChange(sail.id, {
                target: {
                  name: 'active',
                  checked: !sail.active,
                },
              });
            }}
          >
            <FormGroup switch>
              <Input
                type="switch"
                role="switch"
                id={`${sail.id}-active`}
                name="active"
                checked={sail.active}
              />
              { sail.name }
            </FormGroup>
          </CardHeader>
          <CardBody>
          <CardText
            className={sail.active ? '' : 'text-muted'}
          >{sailText(sail)}</CardText>
          {sail.continuousReefing
            && <FormGroup disabled={!sail.active}>
              <Input
                id={`${sail.id}-furledRatio`}
                disabled={!sail.active}
                name="furledRatio"
                type="range"
                max="1.0"
                min="0.0"
                step="0.1"
                value={sail.reducedState ? sail.reducedState.furledRatio : 0}
                onChange={(e) => handleChange(sail.id, e)}
              />
              <Label
               for={`${sail.id}-furledRatio`}
               className={sail.active ? '' : 'text-muted'}
              >
                Furled
                {' '}
                {sail.reducedState ? sail.reducedState.furledRatio * 100 : 0}%
              </Label>
            </FormGroup>
          }
          {sail.reefs
            && sail.reefs.length
            && <FormGroup tag="fieldset">
              <FormGroup check disabled={!sail.active}>
                <Input
                  id={`${sail.id}-reefs-0`}
                  disabled={!sail.active}
                  name="reefs"
                  value="0"
                  type="radio"
                  checked={!sail.reducedState || sail.reducedState.reefs === 0}
                  onChange={(e) => handleChange(sail.id, e)}
                />
                <Label
                  for={`${sail.id}-furledRatio`}
                  check
                  onClick={() => {
                    handleChange(sail.id, {
                      target: {
                        name: 'reefs',
                        value: 0,
                      },
                    });
                  }}
                >
                  Unreefed
                </Label>
              </FormGroup>
              {sail.reefs.map((reef, idx) => (
                <FormGroup key={`${sail.id}-${idx + 1}`} check disabled={!sail.active}>
                  <Input
                    id={`${sail.id}-reefs-${idx + 1}`}
                    disabled={!sail.active}
                    name="reefs"
                    value={idx + 1}
                    type="radio"
                    checked={sail.reducedState && sail.reducedState.reefs === (idx + 1)}
                    onChange={(e) => handleChange(sail.id, e)}
                  />
                  <Label
                    for={`${sail.id}-reefs-${idx + 1}`}
                    check
                    onClick={() => {
                      handleChange(sail.id, {
                        target: {
                          name: 'reefs',
                          value: idx + 1,
                        },
                      });
                    }}
                  >
                    {`${ordinal(idx + 1)} reef (${reef}m\u00B2)`}
                  </Label>
                </FormGroup>
              ))}
            </FormGroup>
          }
          </CardBody>
        </Card>
      ))}
      {filler.map((id) => (
        <Card
          key={id}
        />
      ))}
     </CardGroup>,
    );
  }
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Sails
      </ModalHeader>
      <ModalBody>
        <Form>{rows}</Form>
        {!sails.length
          && <div>
          <p>Configure your sail inventory in the sailsconfiguration plugin</p>
          <Button color="primary" onClick={() => {
            window.location.hash = '#/serverConfiguration/plugins/sailsconfiguration';
          }}>
            Configure
          </Button>
        </div>}
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={() => props.save(sails)}>
          Save
        </Button>{' '}
        <Button color="secondary" onClick={props.cancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default SailEditor;
