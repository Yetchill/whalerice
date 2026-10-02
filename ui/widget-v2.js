const pet=createPet(document.querySelector('#pet'));
window.whale.subscribe(state=>pet.update(state));
window.whale.state().then(state=>pet.update(state));
document.addEventListener('contextmenu',event=>{event.preventDefault();window.whale.contextMenu();});
