import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  FormText,
  Label,
  Input,
} from 'reactstrap';
import ordinal from 'ordinal';

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
          {sails.map((sail) => (
            <FormGroup tag="fieldset" key={sail.id}>
              <legend>
                {sail.name}
              </legend>
              <FormText>
                {sail.type} sail made by {sail.brand}
              </FormText>
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
                >Active</Label>
              </FormGroup>
              {sail.continuousReefing
                && <FormGroup>
                  <Input
                    id={`${sail.id}-furledRatio`}
                    name="furledRatio"
                    type="range"
                    max="1.0"
                    min="0.0"
                    step="0.1"
                    value={sail.reducedState ? sail.reducedState.furledRatio : 0}
                    onChange={(e) => handleChange(sail.id, e)}
                  />
                  <Label for={`${sail.id}-furledRatio`}>
                    Furled
                    {' '}
                    {sail.reducedState ? sail.reducedState.furledRatio * 100 : 0}%
                  </Label>
                </FormGroup>
              }
              {sail.reefs
                && sail.reefs.length
                && <FormGroup tag="fieldset">
                  <FormGroup check>
                    <Input
                      id={`${sail.id}-reefs-0`}
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
                    <FormGroup key={`${sail.id}-${reef}`} check>
                      <Input
                        id={`${sail.id}-reefs-${reef}`}
                        name="reefs"
                        value={reef}
                        type="radio"
                        checked={sail.reducedState && sail.reducedState.reefs === reef}
                        onChange={(e) => handleChange(sail.id, e)}
                      />
                      <Label for={`${sail.id}-furledRatio`} check>
                        {`${ordinal(reef)} reef`}
                      </Label>
                    </FormGroup>
                  ))}
                </FormGroup>
              }
            </FormGroup>
          ))}
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
