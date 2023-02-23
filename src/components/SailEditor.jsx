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
  string += `${sail.type.charAt(0).toUpperCase()}${sail.type.slice(1)}`;
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
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Sails
      </ModalHeader>
      <ModalBody>
        <Form>
          <CardGroup>
          {sails.map((sail) => (
            <Card
              key={sail.id}
            >
              <CardHeader
                className={sail.active ? 'bg-primary' : ''}
              >
                <FormGroup switch>
                  <Input
                    type="switch"
                    role="switch"
                    id={`${sail.id}-active`}
                    name="active"
                    checked={sail.active}
                    onChange={(e) => handleChange(sail.id, e)}
                  />
                  <Label
                    for={`${sail.id}-active`}
                    check
                  >
                    {sail.name}
                  </Label>
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
                    <Label for={`${sail.id}-furledRatio`} check>
                      Unreefed
                    </Label>
                  </FormGroup>
                  {sail.reefs.map((reef) => (
                    <FormGroup key={`${sail.id}-${reef}`} check disabled={!sail.active}>
                      <Input
                        id={`${sail.id}-reefs-${reef}`}
                        disabled={!sail.active}
                        name="reefs"
                        value={reef}
                        type="radio"
                        checked={sail.reducedState && sail.reducedState.reefs === reef}
                        onChange={(e) => handleChange(sail.id, e)}
                      />
                      <Label for={`${sail.id}-reefs-${reef}`} check>
                        {`${ordinal(reef)} reef`}
                      </Label>
                    </FormGroup>
                  ))}
                </FormGroup>
              }
              </CardBody>
            </Card>
          ))}
         </CardGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={props.save}>
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
