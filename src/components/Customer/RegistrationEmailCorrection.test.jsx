import React from 'react';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {I18nextProvider} from 'react-i18next';
import i18next from 'i18next';
import en from '../../i18n/locales/en.json';
import RegistrationEmailCorrection from './RegistrationEmailCorrection';
const correct=vi.hoisted(()=>vi.fn());
vi.mock('../../services/registration.service',()=>({registrationService:{correct}}));
let i18n;
beforeEach(async()=>{vi.resetAllMocks();i18n=i18next.createInstance();await i18n.init({lng:'en',resources:{en:{translation:en}}});});
afterEach(cleanup);
function mount(props={}){return render(<I18nextProvider i18n={i18n}><RegistrationEmailCorrection email="wrong@example.test" {...props}/></I18nextProvider>);}
it('corrects the pending account with its registration password and clears the form on success',async()=>{
 const onCorrected=vi.fn();correct.mockResolvedValue({email:'right@example.test',delivered:true});mount({onCorrected,audience:'team'});
 fireEvent.click(screen.getByRole('button',{name:en.accountEmail.correct}));
 fireEvent.change(screen.getByLabelText(en.accountEmail.newEmail),{target:{value:'right@example.test'}});
 fireEvent.change(screen.getByLabelText(en.accountEmail.registrationPassword),{target:{value:'Synthetic12!'}});
 fireEvent.click(screen.getByRole('button',{name:en.accountEmail.saveCorrection}));
 await screen.findByRole('button',{name:en.accountEmail.correct});expect(onCorrected).toHaveBeenCalledWith({email:'right@example.test',delivered:true});
 expect(correct).toHaveBeenCalledWith({email:'wrong@example.test',newEmail:'right@example.test',password:'Synthetic12!',audience:'team',returnTo:undefined});
 expect(screen.queryByLabelText(en.accountEmail.registrationPassword)).not.toBeInTheDocument();
});
it('explains refused corrections and keeps the existing verification address',async()=>{
 const onCorrected=vi.fn();correct.mockRejectedValue(new Error('REGISTRATION_CANNOT_CORRECT'));mount({onCorrected});fireEvent.click(screen.getByRole('button',{name:en.accountEmail.correct}));
 fireEvent.change(screen.getByLabelText(en.accountEmail.newEmail),{target:{value:'right@example.test'}});fireEvent.change(screen.getByLabelText(en.accountEmail.registrationPassword),{target:{value:'WrongPass12!'}});fireEvent.click(screen.getByRole('button',{name:en.accountEmail.saveCorrection}));
 expect(await screen.findByRole('alert')).toHaveTextContent(en.accountEmail.errors.REGISTRATION_CANNOT_CORRECT);expect(onCorrected).not.toHaveBeenCalled();
});
