import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen} from '@testing-library/react';
import BookingContact from './BookingContact';
vi.mock('react-i18next',()=>({useTranslation:()=>({t:key=>key})}));
afterEach(cleanup);
it('shows the canonical guest email without an empty phone row',()=>{
 render(<BookingContact booking={{customerEmail:'guest@example.test',customerCountryCode:'+965',customerPhone:null}}/>);
 expect(screen.getByRole('link',{name:'guest@example.test'})).toHaveAttribute('href','mailto:guest@example.test');
 expect(screen.queryByText('common.phone')).not.toBeInTheDocument();
 expect(screen.queryByText('+965')).not.toBeInTheDocument();
});
it('shows both contacts when an optional phone is present',()=>{
 render(<BookingContact booking={{customerEmail:'guest@example.test',customerCountryCode:'+965',customerPhone:'50000099'}}/>);
 expect(screen.getByText('common.email')).toBeInTheDocument();expect(screen.getByText('+965 50000099')).toBeInTheDocument();
});
it('keeps malformed legacy email as text instead of an unsafe mail link',()=>{
 render(<BookingContact booking={{customerEmail:'user@example.test\r\nBcc:other@example.test'}}/>);
 expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
