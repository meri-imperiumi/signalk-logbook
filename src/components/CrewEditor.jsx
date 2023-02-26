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
  ListGroup,
  ListGroupItem,
} from 'reactstrap';

function CrewEditor(props) {
  const [crewNames, updateCrew] = useState(props.crewNames);
  const [addCrew, updateAddCrew] = useState('');
  function handleAddChange(e) {
    const { value } = e.target;
    updateAddCrew(value);
  }
  function addCrewMember() {
    if (!addCrew) {
      return;
    }
    const crew = [
      ...crewNames,
      addCrew,
    ];
    updateCrew(crew);
    updateAddCrew('');
  }
  return (
    <Modal isOpen={true} toggle={props.cancel}>
      <ModalHeader toggle={props.cancel}>
        Crew
      </ModalHeader>
      <ModalBody>
        <ListGroup flush>
          {crewNames.map((name, idx) => (
            <ListGroupItem key={name}>
              {name}
              {' '}
              <Button onClick={() => {
                const crew = [...crewNames];
                crew.splice(idx, 1);
                updateCrew(crew);
              }}>X</Button>
            </ListGroupItem>
          ))}
        </ListGroup>
        <Form>
          <FormGroup>
            <Label for="add">
              Add crew
            </Label>
            <Input
              id="add"
              name="add"
              placeholder="bergie"
              color="primary"
              value={addCrew}
              onChange={handleAddChange}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  addCrewMember();
                  e.stopPropagation();
                  e.preventDefault();
                }
              }}
            />
            <Button onClick={addCrewMember}>Add</Button>
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" onClick={props.cancel}>
          Save
        </Button>{' '}
        <Button color="secondary" onClick={props.cancel}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
}

export default CrewEditor;
