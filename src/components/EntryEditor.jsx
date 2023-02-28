import React, { useState } from 'react';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  Label,
  Input,
  InputGroup,
  InputGroupText,
  Row,
  Col,
  Accordion,
  AccordionBody,
  AccordionHeader,
  AccordionItem,
} from 'reactstrap';
import { getSeaStates } from '../helpers/observations';

function EntryEditor(props) {
  const [entry, updateEntry] = useState(props.entry);

  // Default: should observations be open?
  const [open, setOpen] = useState(entry.observations || !Number.isNaN(Number(entry.ago)) ? 'observations' : '');
  function toggle(id) {
    if (open === id) {
      setOpen();
    } else {
      setOpen(id);
    }
  }

  function handleChange(e) {
    const { name, value } = e.target;
    const updated = {
      ...entry,
    };
    if (name === 'seaState') {
      if (!updated.observations) {
        updated.observations = {};
      }
      const val = parseInt(value, 10);
      if (val === -1) {
        // No observation
        delete updated.observations[name];
      } else {
        updated.observations[name] = val;
      }
    } else if (name === 'cloudCoverage') {
      if (!updated.observations) {
        updated.observations = {};
      }
      const val = parseInt(value, 10);
      if (val === -1) {
        // No observation
        delete updated.observations[name];
      } else {
        updated.observations[name] = val;
      }
    } else {
      updated[name] = value;
    }
    updateEntry(updated);
  }
  function save() {
    props.save(entry);
  }
  function deleteEntry() {
    props.delete(entry);
  }
  const seaStates = getSeaStates();
  const agoOptions = [
    0,
    5,
    10,
    15,
  ];
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        { Number.isNaN(Number(entry.ago))
          && `Log entry ${entry.date.toLocaleString('en-GB', { timeZone: 'UTC' })} by ${entry.author || 'auto'}`}
        { !Number.isNaN(Number(entry.ago))
          && 'New entry'}
      </ModalHeader>
      <ModalBody>
        { Number.isNaN(Number(entry.ago))
          && <Row>
          <Col className="text-end text-right">
            <Button color="danger" onClick={deleteEntry}>
              Delete
            </Button>
          </Col>
        </Row>
        }
        <Form>
          <FormGroup>
            <Label for="text">
              Remarks
            </Label>
            <Input
              id="text"
              name="text"
              type="textarea"
              placeholder="Tell what happened"
              value={entry.text}
              onChange={handleChange}
            />
          </FormGroup>
          { !Number.isNaN(Number(entry.ago))
            && <FormGroup>
            <Label for="ago">
              This happened
            </Label>
            <Input
              id="ago"
              name="ago"
              type="select"
              value={entry.text}
              onChange={handleChange}
            >
              {agoOptions.map((ago) => (
              <option key={ago} value={ago}>{ago} minutes ago</option>
              ))}
            </Input>
          </FormGroup>
          }
          <FormGroup>
            <Label for="category">
              Category
            </Label>
            <Input
              id="category"
              name="category"
              type="select"
              value={entry.category}
              onChange={handleChange}
            >
              {props.categories.map((category) => (
              <option key={category} value={category}>{category}</option>
              ))}
            </Input>
          </FormGroup>
          { entry.category === 'radio'
            && <FormGroup>
                <Label for="vhf">
                  VHF channel
                </Label>
                <Input
                  id="vhf"
                  name="vhf"
                  placeholder="16"
                  value={entry.vhf}
                  onChange={handleChange}
                />
              </FormGroup>
          }
          <Accordion open={open} toggle={toggle}>
            <AccordionItem>
              <AccordionHeader targetId="observations">Observations</AccordionHeader>
              <AccordionBody accordionId="observations">
                <FormGroup>
                  <Label for="seaState">
                    Sea state
                  </Label>
                  <Input
                    id="seaState"
                    name="seaState"
                    type="select"
                    value={entry.observations ? entry.observations.seaState : -1}
                    onChange={handleChange}
                  >
                    {seaStates.map((description, idx) => (
                    <option key={idx} value={idx - 1}>{description}</option>
                    ))}
                  </Input>
                </FormGroup>
                <FormGroup>
                  <Label for="cloudCoverage">
                    Cloud coverage
                  </Label>
                  <InputGroup>
                    <Input
                      id="cloudCoverage"
                      name="cloudCoverage"
                      type="range"
                      min="-1"
                      max="8"
                      step="1"
                      value={entry.observations ? entry.observations.cloudCoverage : -1}
                      onChange={handleChange}
                    />
                    <InputGroupText>
                      {entry.observations
                        && entry.observations.cloudCoverage > -1 ? `${entry.observations.cloudCoverage}/8` : 'n/a'}
                    </InputGroupText>
                  </InputGroup>
                </FormGroup>
              </AccordionBody>
            </AccordionItem>
          </Accordion>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={save}>
          Save
        </Button>{' '}
        <Button color="secondary" onClick={props.cancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default EntryEditor;
